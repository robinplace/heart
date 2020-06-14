const VERSION = `v7`

self.addEventListener (`install`, ev => ev.waitUntil (
	caches.open (VERSION)
	.then (cache => cache.addAll ([
		`./checkin.css`,
		`./checkin.html`,
		`./checkin.js`,
		`./date_fns.min.js`,
		`./redux.min.js`,
		`./react.min.js`,
		`./react-dom.min.js`,
		`./react-redux.min.js`,
	]))
))

self.addEventListener (`fetch`, ev => ev.respondWith (
	caches.open (VERSION)
	.then (cache => cache.match (ev.request))
	.then (res => res || fetch (ev.request))
))

self.addEventListener (`activate`, ev => ev.waitUntil (
	caches.keys ().then (keys => Promise.all (keys.map (key => {
		if (key !== VERSION) return caches.delete (key)
	})))
))
