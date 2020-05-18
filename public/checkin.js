const SPREADSHEET_ID = `%SPREADSHEET_ID%`
const GAPI_INIT = {
	clientId: `%CLIENT_ID%`,
	apiKey: `%API_KEY%`,
	scope: `https://www.googleapis.com/auth/spreadsheets`,
	discoveryDocs: [ `https://sheets.googleapis.com/$discovery/rest?version=v4` ],
}
const SHEETS = [
	[ `memberships`, `Memberships`, 2 ],
	[ `todo`,        `Todo`,        2 ],
	[ `checkins`,    `Checkins`,    2 ],
]
const HEADINGS = [
	[ `person`,  `PERSON`,  `id`     ],
	[ `name`,    `NAME`,    `text`   ],
	[ `phone`,   `PHONE`,   `phone`  ],
	[ `plan`,    `PLAN`,    `text`   ],
	[ `price`,   `PRICE`,   `number` ],
	[ `start`,   `START`,   `date`   ],
	[ `end`,     `END`,     `date`   ],
	[ `note`,    `NOTE`,    `text`   ],
	[ `type`,    `TYPE`,    `text`   ],
	[ `months`,  `MONTHS`,  `number` ],
	[ `date`,    `DATE`,    `date`   ],
	[ `time`,    `TIME`,    `time`   ],
	[ `todo`,    `TODO`,    `text`   ],
]

const { createStore, combineReducers, applyMiddleware } = Redux
const { createElement: h, Fragment, memo, useState, useReducer, useMemo, useEffect, useCallback, useRef } = React
const { render } = ReactDOM
const { Provider, useSelector, shallowEqual, useDispatch } = ReactRedux
const useShallowSelector = selector => useSelector (selector, shallowEqual)

const store = createStore (combineReducers ({
	loaded: (loaded = {
		local: null,
		gapi: null,
		auth2: null,
		gapiInit: null,
		spreadsheet: null,
	}, action) => { switch (action.type) {
		case `LOADED`: return { ...loaded, [action.loader]: true }
		case `LOAD_FAILED`: return { ...loaded, [action.loader]: false }
		case `LOAD_RETRY`: return { ...loaded, [action.loader]: null }
		default: return loaded
	} },
	signedIn: (signedIn = null, action) => { switch (action.type) {
		case `LOADED`: return action.payload.signedIn || signedIn
		case `SIGNIN`: return action.signedIn
		default: return signedIn
	} },
	syncQueue: (syncQueue = [], action) => { switch (action.type) {
		case `LOADED`: return action.payload.syncQueue || syncQueue
		case `SYNCED`: return syncQueue.filter (aa => aa !== action.action)
		case `APPEND`: return [ ...syncQueue, action ]
		default: return syncQueue
	} },
	rows: (rows = {
		memberships: [],
		todo: [],
		checkins: [],
	}, action) => { switch (action.type) {
		case `LOADED`: return action.payload.rows || rows
		case `APPEND`: return { ...rows, [action.sheet]: [ ...rows [action.sheet], { ...action.row, index: rows [action.sheet].length } ] }
		default: return rows
	} },
	keys: (keys = {
		memberships: [],
		todo: [],
		checkins: [],
	}, action) => { switch (action.type) {
		case `LOADED`: return action.payload.keys || keys
		default: return keys
	} },
	search: (search = { search: ``, count: 5 }, action) => { switch (action.type) {
		case `LOADED`: return { ...search, ...action.payload.search }
		case `SEARCH`: return action.search
		default: return search
	} },
}), {}, applyMiddleware (store => next => action => {
	const prev = store.getState ()
	try {
		return next (action)
	} finally {
		console.groupCollapsed (`action`, action.type)
		console.log ('prev state', prev)
		console.log ('action', action)
		console.log ('next state', window.state = store.getState ())
		console.groupEnd ()
	}
}))

const uuid = (length = 5) => {
	let uuid = ``
	for (let i = 0; i < length; i++) uuid += (~~ (Math.random () * 26)).toString (26)
	return uuid
}

const parseSheet = ({ values }, headingRows) => {
	if (values.length <= headingRows) return { rows: [], keys: [] }

	const headings = values [headingRows - 1].map (text => HEADINGS.find (heading => heading [1] === text))

	const rows = []
	for (let i = headingRows; i < values.length; i++) {
		const row = values [i]
		if (row.length === 0) continue
		rows.push (row.reduce ((rows, value, offset) => {
			const heading = headings [offset]
			if (!heading) return rows
			const [ key, column, type ] = heading
			// again, prefer the first occurrence
			return { [key]: parseValue (value, type), ...rows }
		}, { index: rows.length }))
	}

	const keys = headings.map (heading => heading && heading [0])

	return { rows, keys }
}

const parseValue = (value, type) => { switch (type) {
	case `text`: return `${value}`.trim ()
	case `date`: return value ? parseDate (value) : null
	case `time`: return value ? parseTime (value) : null
	case `number`: return `${value}`.replace (`$`, ``)  * 1 || 0
	case `phone`: return `${value}`.trim ()
	case `id`: return `${value}`.trim ()
	default: return `${value}`.trim ()
} }

const lettersByColumn = `ABCDEFGHIJKLMNOPQRSTUVWXYZ`.split (``)

const appendSheet = (sheet, row) => {
	const keys = store.getState ().keys [sheet]
	if (!keys) return Promise.reject ()
	const values = keys.map (key => {
		if (!key) return ``
		const type = HEADINGS.find (h => h [0] === key) [2]
		return formatValue (row [key], type)
	})
	console.log (`INSERT_ROWS`, sheet, values)
	return gapi.client.sheets.spreadsheets.values.append ({
		spreadsheetId: SPREADSHEET_ID,
		range: sheetToRange (SHEETS.find (s => s [0] === sheet) [1]),
		valueInputOption: `USER_ENTERED`,
		insertDataOption: `INSERT_ROWS`,
		includeValuesInResponse: true,
		resource: { values: [ values ] },
	})
}

const formatValue = (value, type) => { switch (type) {
	case `date`: return value ? formatDate (value) : ``
	case `time`: return value ? formatTime (value) : ``
	case `id`: return `'${value}`
	default: return `${value}`
} }

const formatDate = timestamp => dateFns.format (timestamp, `MM/DD/YYYY`)
const formatTime = timestamp => dateFns.format (timestamp, `h:mm:ss A`)

const parseDate = date => new Date (`12:00:00 AM ${date}`) * 1
const parseTime = time => new Date (`${time} ${formatDate (timestampToday ())}`) * 1

const timestampToday = () => parseDate (formatDate (Date.now () - 1000 * 60 * 60 * 4))
const timestampNow = () => Date.now ()

const toOrdinal = n => n + ([,'st','nd','rd'][n%100>>3^1&&n%10]||'th')

const sheetToRange = sheet => `${sheet}!A:ZZ`

const Wrapper = () => {
	return h (React.Fragment, null,
		h (LocalLoader),
		h (LocalWorker),
		h (GapiLoader),
		h (Auth2Loader),
		h (GapiInitLoader),
		h (SignInListener),
		h (SyncWorker),
		h (SpreadsheetLoader),
		h (App),
	)
}

const Loader = ({ loader, ready, promise, retry = true }) => {           
	const dispatch = useDispatch ()
	const loaded = useSelector (s => s.loaded [loader])
	useEffect (() => {
		if (ready === true && loaded === null) promise ().then (
			(payload = {}) => dispatch ({ type: `LOADED`, loader, payload }),
			error => dispatch ({ type: `LOAD_FAILED`, loader, error }))
		if (ready === true && loaded === false && retry) setTimeout (
			() => dispatch ({ type: `LOAD_RETRY`, loader }), 2000)
	}, [ ready, loaded ])
	return null
}

const LocalLoader = () => h (Loader, {
	loader: `local`, ready: true, retry: false,
	promise: () => Promise.resolve ({
		keys: JSON.parse (localStorage.getItem (`keys`) || `{}`),
		rows: JSON.parse (localStorage.getItem (`rows`) || `{}`),
		syncQueue: JSON.parse (localStorage.getItem (`syncQueue`) || `[]`),
		signedIn: JSON.parse (localStorage.getItem (`signedIn`) || `false`),
		search: JSON.parse (localStorage.getItem (`search`) || `{}`),
	}),
})

const LocalWorker = () => {
	const keys = useSelector (s => s.keys)
	const rows = useSelector (s => s.rows)
	const syncQueue = useSelector (s => s.syncQueue)
	const signedIn = useSelector (s => s.signedIn)
	const search = useSelector (s => s.search)
	useEffect (() => localStorage.setItem (`keys`, JSON.stringify (keys)), [ keys ])
	useEffect (() => localStorage.setItem (`rows`, JSON.stringify (rows)), [ rows ])
	useEffect (() => localStorage.setItem (`syncQueue`, JSON.stringify (syncQueue)), [ syncQueue ])
	useEffect (() => localStorage.setItem (`signedIn`, JSON.stringify (signedIn)), [ signedIn ])
	useEffect (() => localStorage.setItem (`search`, JSON.stringify (search)), [ search ])
	return null
}

const GapiLoader = () => h (Loader, {
	loader: `gapi`, ready: true,
	promise: () => new Promise ((res, rej) => {
		const script = document.createElement (`script`)
		script.src = `https://apis.google.com/js/api.js`
		script.defer = true
		script.async = true
		script.addEventListener (`load`, ev => res ())
		script.addEventListener (`readystatechange`, ev => script.readyState === `complete` && res ())
		script.addEventListener (`error`, ev => rej (ev))
		document.body.appendChild (script)
	}),
})

const Auth2Loader = () => h (Loader, {
	loader: `auth2`, ready: useSelector (s => s.loaded.gapi),
	promise: () => new Promise (res => gapi.load (`client:auth2`, res)),
})

const GapiInitLoader = () => h (Loader, {
	loader: `gapiInit`, ready: useSelector (s => s.loaded.auth2),
	promise: () => gapi.client.init (GAPI_INIT),
})

const SignInListener = () => {
	const ready = useSelector (s => s.loaded.gapiInit)
	const dispatch = useDispatch ()
	const onSignIn = useCallback (signedIn => {
		dispatch ({ type: `SIGNIN`, signedIn })
	}, [ dispatch ])
	useEffect (() => {
		if (ready === true) {
			gapi.auth2.getAuthInstance ().isSignedIn.listen (onSignIn) // listen for sign-in state changes.
			onSignIn (gapi.auth2.getAuthInstance ().isSignedIn.get ()) // handle the initial sign-in state.
		}
	}, [ ready, onSignIn ])
	return null
}

const SyncWorker = () => {
	const ready = useSelector (s => s.loaded.gapiInit && s.signedIn)
	const action = useSelector (s => s.syncQueue [0])
	const dispatch = useDispatch ()
	useEffect (() => {
		if (!ready || !action) {
			return
		} else if (action.type === `APPEND`) {
			appendSheet (action.sheet, action.row).then (response => dispatch ({ type: `SYNCED`, action }))
		}
	}, [ ready, action, dispatch ])
	return null
}

const SpreadsheetLoader = () => h (Loader, {
	loader: `spreadsheet`, ready: useSelector (s => s.loaded.gapiInit && s.signedIn && s.syncQueue.length === 0),
	promise: () => gapi.client.sheets.spreadsheets.values.batchGet ({
		spreadsheetId: SPREADSHEET_ID,
		ranges: SHEETS.map (sheet => sheet [1]).map (sheetToRange),
	}).then (({ result }) => SHEETS.map (([ key, name, headingRows ], index) => ([
		key, parseSheet (result.valueRanges [index], headingRows),
	])).reduce ((data, [ key, { rows, keys } ]) => ({
		rows: { ...data.rows, [key]: rows },
		keys: { ...data.keys, [key]: keys },
	}), { rows: {}, keys: {} })),
})

const App = () => {
	const dispatch = useDispatch ()
	const local = useSelector (s => s.loaded.local)
	const hostNote = useCallback (() => {
		const note = prompt (`Leave a note for the host`)
		if (!note) return
		dispatch ({ type: `APPEND`, sheet: `todo`, row: { todo: `NOTE ${note}` } })
	}, [ dispatch ])
	const signedIn = useSelector (s => s.signedIn)
	const signIn = useCallback (() => gapi.auth2.getAuthInstance ().signIn (), [])
	const signOut = useCallback (() => gapi.auth2.getAuthInstance ().signOut (), [])

	if (!local) return null
	return h (`main`, { className: `App Column` },
		h (`header`, { className: `Row` },
			h (`h1`, null, `Heart of Country Swing`),
			h (Text, null, h (StatusIndicator)),
			h (Button, { onClick: hostNote }, `Leave a note \u{1F5D2}\u{FE0F}`),
			signedIn || h (Button, { onClick: signIn }, `Sign in \u{1F6AA}`),
			signedIn && h (Button, { onClick: signOut }, `Sign out \u{1F512}`),
		),
		h (Search),
	)
}

const StatusIndicator = () => {
	const signedIn = useSelector (s => s.signedIn)
	const loaded = useSelector (s => s.loaded)
	const syncing = useSelector (s => s.syncQueue.length)
	const t = timestampToday ()
	const checkedIn = useSelector (s => s.rows.checkins.filter (r => r.date === t).length)

	if (loaded.local === null) return `Loading cache`
	if (!loaded.gapi) return `Loading gapi`
	if (!loaded.auth2) return `Loading auth2 api`
	if (!loaded.gapiInit) return `Connecting to gapi`
	if (signedIn === null) return `Loading sign in`
	if (signedIn === false) return `Not signed in`
	if (!loaded.spreadsheet) return `Loading data`
	if (syncing > 0) return `Saving ${syncing} ${syncing === 1 ? `change` :`changes`}`
	return `${checkedIn} ${checkedIn === 1 ? `person` : `people`} checked in`
}

const Search = () => {
	const dispatch = useDispatch ()
	const { search } = useSelector (s => s.search)
	const setSearch = useCallback (ev => {
		dispatch ({ type: `SEARCH`, search: { search: ev.target.value, count: 5 } })
	}, [ dispatch ])

	return h (Fragment, null,
		h (`input`, { className: `SearchInput`, placeholder: `Enter a name or phone #`, onChange: setSearch, value: search }),
		h (Memberships),
	)
}

const Memberships = () => {
	const dispatch = useDispatch ()
	const { search, count } = useSelector (s => s.search)
	const moreMemberships = useCallback (() => {
		dispatch ({ type: `SEARCH`, search: { search, count: count + 5 } })
	}, [ dispatch, search, count ])

	const memberships = useSelector (s => s.rows.memberships)
	const sorted = useMemo (() => [ ...memberships ].sort ((a, b) => {
		if (a.start < b.start) return 1
		if (a.start > b.start) return -1
		return 0
	}), [ memberships ])
	const filtered = useMemo (() => sorted.filter (membership => {
		if (membership.name && membership.name.toLowerCase ().indexOf (search.toLowerCase ()) !== -1) return true
		if (membership.phone && membership.phone.indexOf (search) !== -1) return true
		return false
	}), [ sorted, search ])
	const limited = useMemo (() => filtered.slice (0, count), [ filtered, count ])
	const hasMore = filtered.length > count

	return h (`div`, { className: `List Memberships` },
		limited.map (({ index }) => h (Membership, { key: index, index })),
		hasMore || h (NewButtons),
		hasMore && h (Button, { onClick: moreMemberships }, `More`),
	)
}

const NewButtons = () => {
	const dispatch = useDispatch ()
	const { search } = useSelector (s => s.search)

	const isPhone = search.match (/^\d+$/)
	const extra = isPhone ? `with phone ${search}` : `named ${search}`

	const newGuest = useCallback (() => {
		const other = prompt (isPhone ? `Name for ${search}` : `Phone number for ${search}`)
		if (!other) return
		const name = isPhone ? other : search
		const phone = isPhone ? search : other
		const person = uuid ()
		dispatch ({ type: `APPEND`, sheet: `todo`, row: { date: timestampToday (), time: timestampNow (), person, name, phone, todo: `NEW GUEST` } })
		dispatch ({ type: `APPEND`, sheet: `checkins`, row: { person, date: timestampToday (), time: timestampNow (), note: `GUEST` } })
	}, [ dispatch, search, isPhone ])
	const newMembership = useCallback (() => {
		const other = prompt (isPhone ? `Name for ${search}` : `Phone number for ${search}`)
		if (!other) return
		const name = isPhone ? other : search
		const phone = isPhone ? search : other
		const plan = prompt (`Plan for ${name}`)
		if (!plan) return
		const person = uuid ()
		dispatch ({ type: `APPEND`, sheet: `todo`, row: { date: timestampToday (), time: timestampNow (), person, name, phone, todo: `NEW MEMBER PLAN (${plan})` } })
		dispatch ({ type: `APPEND`, sheet: `checkins`, row: { person, date: timestampToday (), time: timestampNow (), note: `MEMBER` } })
	}, [ dispatch, search, isPhone ])

	return h (Fragment, null,
		h (Button, { onClick: newMembership }, `New member ${extra}`),
		h (Button, { onClick: newGuest }, `New guest ${extra}`),
	)
}

const Membership = memo (({ index }) => {
	const dispatch = useDispatch ()
	const membership = useSelector (s => s.rows.memberships [index])
	const expired = membership.end && membership.end < timestampToday ()
	const checkInMember = useCallback (() => {
		dispatch ({ type: `APPEND`, sheet: `checkins`, row: { person: membership.person, date: timestampToday (), time: timestampNow (), note: `MEMBER` } })
	}, [ membership ])
	const checkInGuest = useCallback (() => {
		dispatch ({ type: `APPEND`, sheet: `checkins`, row: { person: membership.person, date: timestampToday (), time: timestampNow (), note: `GUEST` } })
	}, [ membership ])
	const renewMembership = useCallback (() => {
		const plan = prompt (`New plan for ${membership.name}`)
		if (!plan) return
		dispatch ({ type: `APPEND`, sheet: `todo`, row: { date: timestampToday (), time: timestampNow (), person: membership.person, name: membership.name, phone: membership.phone, todo: `RENEW PLAN (${plan})` } })
		dispatch ({ type: `APPEND`, sheet: `checkins`, row: { person: membership.person, date: timestampToday (), time: timestampNow (), note: `MEMBER` } })
	}, [ membership ])
	const hostNote = useCallback (() => {
		const note = prompt (`Leave a note for the host`)
		if (!note) return
		dispatch ({ type: `APPEND`, sheet: `todo`, row: { date: timestampToday (), time: timestampNow (), person: membership.person, name: membership.name, phone: membership.phone, todo: `NOTE ${note}` } })
	}, [ membership ])

	const checkIns = useShallowSelector (s => s.rows.checkins.filter (r => r.person === membership.person))
	const t = timestampToday ()
	const checkedIn = !!checkIns.find (r => r.date === t)
	const loyalty = useMemo (() => {
		const total = checkIns.length
		const guests = checkIns.filter (r => r.note === `GUEST`).length
		return total - guests
	}, [ checkIns ])

	return h (`article`, { className: `Membership Row${expired ? ` expired` : ``}` },
		h (TextCell, { className: `Person` }, membership.person),
		h (TextCell, { className: `Name` }, membership.name),
		h (TextCell, { className: `Phone` }, membership.phone),
		h (TextCell, { className: `Plan` }, `${membership.plan}, from ${formatDate (membership.start)}${membership.end ? ` to ${formatDate (membership.end)}` : ``}`),
		h (TextCell, { className: `End` }, ),
		h (TextCell, { className: `Note Spacer` }, membership.note),
		h (TextCell, { className: `Loyalty` }, `${loyalty}x`),
		checkedIn || expired || h (Button, { onClick: checkInMember }, `Check in`),
		checkedIn || expired && h (Button, { onClick: checkInGuest }, `As guest`),
		checkedIn && h (Button, { disabled: true }, `Checked in`),
		expired && h (Button, { onClick: renewMembership }, `Renew`),
		h (Button, { onClick: hostNote }, `\u{1F5D2}\u{FE0F}`),
	)
})

const TextCell = ({ className = ``, children, ...props }) => {
	return h (Cell, { className: `Cell ${className}`, ...props },
		h (Text, null, children),
	)
}

const Cell = ({ className = ``, children, ...props }) => {
	return h (`span`, { className: `Cell ${className}`, ...props }, children)
}

const Button = ({ className = ``, onClick, children, ...props }) => {
	return h (`button`, { className: `Button ${className}`, onClick, ...props }, children)
}

const Text = ({ className = ``, children, ...props }) => {
	return h (`span`, { className: `Text ${className}`, ...props }, children)
}

document.addEventListener (`readystatechange`, ev => {
	if (document.readyState === `interactive`) {
		const wrapper = document.createElement (`div`)
		wrapper.setAttribute (`class`, `Wrapper`)
		render (h (Provider, { store }, h (Wrapper)), wrapper)
		document.body.appendChild (wrapper)
	}
})
