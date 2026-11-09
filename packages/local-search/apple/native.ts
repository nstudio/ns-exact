import { definePackage } from 'nativescript-exact';

const category = (item: MKMapItem) => (item.pointOfInterestCategory ?? '').replace(/^MKPOICategory/, '');

export default definePackage({
  names: {
    localSearchStatus: () => ({ available: true }),

    searchNearby: ({ query, latitude, longitude }) => new Promise((resolve, reject) => {
      if (!String(query ?? '').trim()) return reject(Object.assign(new Error('query is empty'), { name: 'TypeError' }));
      const origin = CLLocation.alloc().initWithLatitudeLongitude(latitude, longitude);
      const request = MKLocalSearchRequest.new();
      request.naturalLanguageQuery = query;
      request.region = MKCoordinateRegionMakeWithDistance(origin.coordinate, 5000, 5000);
      MKLocalSearch.alloc().initWithRequest(request).startWithCompletionHandler((response, error) => {
        if (error) return reject(Object.assign(new Error(error.localizedDescription), { name: 'NetworkError' }));
        const places = [];
        for (let i = 0; i < response.mapItems.count; i++) {
          const item = response.mapItems.objectAtIndex(i) as MKMapItem;
          const at = item.location;
          places.push({ name: item.name ?? '', category: category(item), latitude: at.coordinate.latitude,
            longitude: at.coordinate.longitude, distance: Math.round(at.distanceFromLocation(origin)) });
        }
        resolve(places.sort((a, b) => a.distance - b.distance).slice(0, 5));
      });
    }),
  },

  views: {
    'ns-spinner': (props) => {
      const spinner = UIActivityIndicatorView.alloc().initWithActivityIndicatorStyle(UIActivityIndicatorViewStyle.Medium);
      spinner.hidesWhenStopped = true;
      const apply = (next: Record<string, string>) => (next.running === 'true' ? spinner.startAnimating() : spinner.stopAnimating());
      apply(props);
      return { view: spinner, setProps: apply };
    },
  },
});
