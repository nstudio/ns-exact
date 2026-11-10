//! `{op: "read", text}` answers `{language, score}`: the text's dominant language as the user's
//! locale names it, and its sentiment from -1 to 1, by Apple's NaturalLanguage framework.

use exact_js::{json, Json, NativeModule, NativeStorage};

pub struct Reading;

impl Reading {
    pub fn new(_app: &str) -> Self {
        Reading
    }
}

impl NativeModule for Reading {
    fn configure_storage(&mut self, _storage: NativeStorage) -> Result<(), String> {
        Ok(())
    }

    fn call(&mut self, request: &Json) -> Result<Json, String> {
        match request["op"].as_str() {
            Some("read") => {
                let text = request["text"].as_str().ok_or("read needs a text")?;
                let (language, score) = apple::read(text)?;
                Ok(json!({ "language": language, "score": (score * 10.0).round() / 10.0 }))
            }
            _ => Err("reading answers read".into()),
        }
    }
}

#[cfg(not(target_vendor = "apple"))]
mod apple {
    pub fn read(_text: &str) -> Result<(String, f64), String> {
        Err("reading needs Apple's NaturalLanguage".into())
    }
}

#[cfg(target_vendor = "apple")]
mod apple {
    use std::ffi::{c_char, c_void, CStr};

    type Id = *mut c_void;
    type Sel = *const c_void;

    #[repr(C)]
    struct Range {
        location: usize,
        length: usize,
    }

    const RTLD_LAZY: i32 = 1;
    const NS_UTF8_STRING_ENCODING: usize = 4;
    const NL_TOKEN_UNIT_PARAGRAPH: isize = 2;

    // libobjc and libSystem, which every Apple app links; NaturalLanguage is loaded at run time.
    extern "C" {
        fn objc_getClass(name: *const c_char) -> Id;
        fn sel_registerName(name: *const c_char) -> Sel;
        fn objc_msgSend();
        fn objc_autoreleasePoolPush() -> *mut c_void;
        fn objc_autoreleasePoolPop(pool: *mut c_void);
        fn dlopen(path: *const c_char, mode: i32) -> *mut c_void;
        fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    }

    /// `objc_msgSend` as the method's own C signature, which arm64 requires.
    unsafe fn msg<F: Copy>() -> F {
        std::mem::transmute_copy(&(objc_msgSend as unsafe extern "C" fn()))
    }

    unsafe fn sel(name: &CStr) -> Sel {
        sel_registerName(name.as_ptr())
    }

    unsafe fn class(name: &CStr) -> Result<Id, String> {
        let class = objc_getClass(name.as_ptr());
        if class.is_null() {
            return Err(format!("no class {}", name.to_string_lossy()));
        }
        Ok(class)
    }

    unsafe fn send0(receiver: Id, name: &CStr) -> Id {
        msg::<unsafe extern "C" fn(Id, Sel) -> Id>()(receiver, sel(name))
    }

    unsafe fn send1(receiver: Id, name: &CStr, argument: Id) -> Id {
        msg::<unsafe extern "C" fn(Id, Sel, Id) -> Id>()(receiver, sel(name), argument)
    }

    unsafe fn ns_string(text: &str) -> Result<Id, String> {
        let init: unsafe extern "C" fn(Id, Sel, *const u8, usize, usize) -> Id = msg();
        let alloc = send0(class(c"NSString")?, c"alloc");
        let string = init(alloc, sel(c"initWithBytes:length:encoding:"), text.as_ptr(), text.len(), NS_UTF8_STRING_ENCODING);
        Ok(send0(string, c"autorelease"))
    }

    unsafe fn rust_string(string: Id) -> String {
        let utf8: unsafe extern "C" fn(Id, Sel) -> *const c_char = msg();
        let bytes = utf8(string, sel(c"UTF8String"));
        if bytes.is_null() {
            return String::new();
        }
        CStr::from_ptr(bytes).to_string_lossy().into_owned()
    }

    pub fn read(text: &str) -> Result<(String, f64), String> {
        // The host may call on a thread with no autorelease pool.
        unsafe {
            let pool = objc_autoreleasePoolPush();
            let read = read_in_pool(text);
            objc_autoreleasePoolPop(pool);
            read
        }
    }

    unsafe fn read_in_pool(text: &str) -> Result<(String, f64), String> {
        let framework = dlopen(c"/System/Library/Frameworks/NaturalLanguage.framework/NaturalLanguage".as_ptr(), RTLD_LAZY);
        if framework.is_null() {
            return Err("NaturalLanguage could not be loaded".into());
        }
        let string = ns_string(text)?;

        let code = send1(class(c"NLLanguageRecognizer")?, c"dominantLanguageForString:", string);
        let language = if code.is_null() || rust_string(code) == "und" {
            String::new()
        } else {
            let locale = send0(class(c"NSLocale")?, c"currentLocale");
            let name = send1(locale, c"localizedStringForLanguageCode:", code);
            rust_string(if name.is_null() { code } else { name })
        };

        let scheme = dlsym(framework, c"NLTagSchemeSentimentScore".as_ptr()) as *const Id;
        if scheme.is_null() {
            return Err("NaturalLanguage has no sentiment score scheme".into());
        }
        let schemes = send1(class(c"NSArray")?, c"arrayWithObject:", *scheme);
        let tagger = send1(send0(class(c"NLTagger")?, c"alloc"), c"initWithTagSchemes:", schemes);
        send1(tagger, c"setString:", string);

        // The score is per paragraph: the text's is their mean, weighted by length.
        let length = msg::<unsafe extern "C" fn(Id, Sel) -> usize>()(string, sel(c"length"));
        let tag_at: unsafe extern "C" fn(Id, Sel, usize, isize, Id, *mut Range) -> Id = msg();
        let (mut total, mut weight, mut at) = (0.0, 0usize, 0usize);
        while at < length {
            let mut range = Range { location: at, length: 0 };
            let tag = tag_at(tagger, sel(c"tagAtIndex:unit:scheme:tokenRange:"), at, NL_TOKEN_UNIT_PARAGRAPH, *scheme, &mut range);
            if let Some(score) = (!tag.is_null()).then(|| rust_string(tag).parse::<f64>().ok()).flatten() {
                total += score * range.length as f64;
                weight += range.length;
            }
            at = (range.location + range.length).max(at + 1);
        }
        send0(tagger, c"release");

        Ok((language, if weight == 0 { 0.0 } else { total / weight as f64 }))
    }
}
