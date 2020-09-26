const VERSION = `%COMMIT_SHORT_SHA%`

self.addEventListener (`install`, ev => ev.waitUntil (
	caches.open (VERSION)
	.then (cache => cache.addAll ([
		`./checkin.css`,
		`./checkin.html`,
		`./checkin.js`,
		`./date_fns.min.js`,
		`./redux.js`,
		`./react.js`,
		`./react-dom.js`,
		`./react-redux.js`,
	]))
))

self.addEventListener (`activate`, ev => ev.waitUntil (
	caches.keys ().then (keys => Promise.all (keys.map (key => {
		console.log (key, key !== VERSION)
		if (key !== VERSION) return caches.delete (key)
	})))
))

self.addEventListener (`fetch`, ev => ev.respondWith (
	caches.open (VERSION)
	.then (cache => cache.match (ev.request))
	.then (res => res || fetch (ev.request))
))
