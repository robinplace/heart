const SPREADSHEET_ID = `%SPREADSHEET_ID%`
const GAPI_INIT = {
	clientId: `%CLIENT_ID%`,
	apiKey: `%API_KEY%`,
	scope: `https://www.googleapis.com/auth/spreadsheets`,
	discoveryDocs: [ `https://sheets.googleapis.com/$discovery/rest?version=v4` ],
}
const FROZEN_ROWS = 1

const { createStore, combineReducers, applyMiddleware } = Redux
const { createElement: h, Fragment, useState, useReducer, useMemo, useEffect, useCallback, useRef } = React
const { render } = ReactDOM
const { Provider, useSelector, useDispatch } = ReactRedux

const loadedReducer = (s = {}, a) => { switch (a.type) {
	case `LOADED`: return { ...s, [a.loader]: true }
	case `LOAD_FAILED`: return { ...s, [a.loader]: false }
	case `LOAD_RETRY`: return { ...s, [a.loader]: null }
	default: return s
} }
const signedInReducer = (s = null, a) => { switch (a.type) {
	case `SIGNIN`: return a.signedIn
	default: return s
} }
const syncQueueReducer = (s = [], a) => { switch (a.type) {
	case `LOADED`: return a.payload.syncQueue || s
	case `APPEND`: return [ ...s, a ]
	case `UPDATE`: return [ ...s, a ]
	default: return s
} }
const rowsReducer = (s = {}, a) => { switch (a.type) {
	case `LOADED`: return a.payload.rows || s
	default: return s
} }
const columnsReducer = (s = {}, a) => { switch (a.type) {
	case `LOADED`: return a.payload.columns || s
	default: return s
} }
const indexesReducer = (s = {}, a) => { switch (a.type) {
	case `LOADED`: return a.payload.indexes || s
	default: return s
} }
const searchReducer = (s = ``, a) => { switch (a.type) {
	case `SEARCH`: return a.payload.search
	default: return s
} }

const store = createStore (combineReducers ({
	loaded: loadedReducer,
	signedIn: signedInReducer,
	syncQueue: syncQueueReducer,
	rows: rowsReducer,
	columns: columnsReducer,
	indexes: indexesReducer,
	search: searchReducer,
}), {
	loaded: {
		local: null,
		gapi: null,
		auth2: null,
		gapiInit: null,
		spreadsheet: null,
	},
	signedIn: null,
	syncQueue: [],
	rows: {
		people: [],
		memberships: [],
		plans: [],
		attendance: [],
		events: [],
	},
	columns: {
		people: {},
		memberships: {},
		plans: {},
		attendance: {},
		events: {},
	},
	indexes: {
	},
	search: ``,
}, applyMiddleware (
	store => next => action => {
		console.groupCollapsed (`action`, action.type)
		console.log ('prev state', store.getState ())
		console.log ('action', action)
		try {
			return next (action)
		} finally {
			console.log ('next state', store.getState ())
			console.groupEnd ()
		}
	}
))

const parseSheet = ({ values }) => {
	if (values.length <= FROZEN_ROWS) return { rows: [], columns: [] }

	const keysByOffset = values [FROZEN_ROWS - 1]
	// prefers the first occurrence of a key
	const offsetsByKey = keysByOffset.reduce ((offsets, key, offset) => ({ [key]: offset, ...offsets }), {})

	const data = []
	for (let i = FROZEN_ROWS; i < values.length; i++) {
		const row = values [i]
		if (row.length === 0) continue
		data.push (row.reduce ((data, value, offset) => {
			const key = keysByOffset [offset]
			if (!key) return data
			// again, prefer the first occurrence
			return { [key]: value, ...data }
		}, { index: data.length, row: i + 1 }))
	}

	return { rows: data, columns: offsetsByKey }
}

const indexBy = (rows, key) => {
	const object = {}
	rows.forEach (row => {
		const index = row [key]
		if (object [index]) object [index].push (row.index)
		else object [index] = [ row.index ]
	})
	return object
}

const appendAttendance = (member, date, time) => gapi.client.sheets.spreadsheets.values.append ({
	spreadsheetId: SPREADSHEET_ID,
	range: `Attendance!A:ZZ`,
	valueInputOption: `USER_ENTERED`,
	insertDataOption: `INSERT_ROWS`,
	includeValuesInResponse: true,
	resource: { values: [
		[ member, `=VLOOKUP(A:A,Members!$A:$B,2,false)`, date, `=VLOOKUP(C:C,Events!$A:$B,2,false)`, time ],
	] },
}).then (response => {
})

const toDate = timestamp => {
	const date = new Date (timestamp - 1000 * 60 * 60 * 4)
	return `${date.getMonth () + 1}/${date.getDate ()}/${date.getFullYear ()}`
}

const toTime = timestamp => {
	const time = new Date (timestamp)
	return `${(time.getHours () % 12 || 12) + 1}:${time.getMinutes ()}:${time.getSeconds ()} ${time.getHours () < 12 ? `AM` : `PM`}`
}

const fromTime = time => new Date (`${time} ${todayDate ()}`) * 1
const fromDate = date => new Date (`00:00:00 ${date}`) * 1

const todayDate = () => toDate (Date.now () - 1000 * 60 * 60 * 4)
const nowTime = () => toTime (Date.now ())

const ordinal = n => n + ([,'st','nd','rd'][n%100>>3^1&&n%10]||'th')

const Wrapper = () => {
	return h (Fragment, {}, [
		h (LocalLoader),
		h (LocalWorker),
		h (GapiLoader),
		h (Auth2Loader),
		h (GapiInitLoader),
		h (SignInListener),
		h (SpreadsheetLoader),
		h (SyncWorker),
		h (App),
	])
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
	promise: () => {
		return new Promise ((res, rej) => {
			const state = localStorage.getItem (`state`)
			if (!state) rej ()
			else res (JSON.parse (state))
		})
	},
})

const LocalWorker = () => {
	const state = useSelector (s => s)
	useEffect (() => {
		localStorage.setItem (`state`, JSON.stringify (state))
	}, [ state ])
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

const SpreadsheetLoader = () => h (Loader, {
	loader: `spreadsheet`, ready: useSelector (s => s.signedIn),
	promise: () => gapi.client.sheets.spreadsheets.values.batchGet ({
		spreadsheetId: SPREADSHEET_ID,
		ranges: [
			`People!A:ZZ`,
			`Memberships!A:ZZ`,
			`Plans!A:ZZ`,
			`Attendance!A:ZZ`,
			`Events!A:ZZ`,
		],
	}).then (response => {
		const ranges = response.result.valueRanges
		const [ rows, columns ] = [
			`people`, `memberships`, `plans`, `attendance`, `events`
		].reduce (([ rows, columns ], name, i) => {
			const sheet = parseSheet (ranges [i])
			return [
				{ ...rows, [name]: sheet.rows },
				{ ...columns, [name]: sheet.columns },
			]
		}, [ {}, {} ])
		const indexes = {
			peopleById: indexBy (rows.people, `id`),
			membershipsByPerson: indexBy (rows.memberships, `person`),
			plansById: indexBy (rows.plans, `id`),
			attendanceByPerson: indexBy (rows.attendance, `person`),
			attendanceByDate: indexBy (rows.attendance, `date`),
			eventsByDate: indexBy (rows.events, `date`),
		}
		return { rows, columns, indexes }
	}),
})

const SyncWorker = () => {
	const last = useSelector (s => s.syncQueue [s.syncQueue.length - 1])
	useEffect (() => { switch (last && last.type) {
		case `APPEND`: break
		case `UPDATE`: break
	} }, [ last ])
	return null
}

const App = () => {
	return h (Fragment, {}, [
		h (Topbar),
		h (Search),
	])
}

const Topbar = () => {
	return h (`div`, { class: `Topbar` }, [
		h (SearchBox),
		h (Indicator),
		h (SearchHead),
	])
}
const SearchBox = () => {
	const dispatch = useDispatch ()
	const search = useSelector (s => s.search)
	const setSearch = useCallback (ev => dispatch ({ type: `SEARCH`, search: ev.target.value }), [ dispatch ])
	return h (`div`, { class: `SearchBox` }, [
		h (`input`, { class: `SearchInput`, placeholder: `Search by name or phone #`, onInput: setSearch, value: search }),
		h (`button`, {}, `Add person`),
	])
}

const Indicator = () => {
	const signedIn = useSelector (s => s.signedIn)
	const signIn = useCallback (() => gapi.auth2.getAuthInstance ().signIn ())
	const signOut = useCallback (() => gapi.auth2.getAuthInstance ().signOut ())
	const loaded = useSelector (s => s.loaded)
	const syncing = useSelector (s => s.syncQueue.length)

	return h (`span`, { class: `Indicator` }, [
		h (`span`, { class: `IndicatorLoading` }, h (IndicatorLoading, { signedIn, loaded, syncing })),
		signedIn === false && h (`button`, { onClick: signIn }, `Sign in` ),
		signedIn === true && h (`button`, { onClick: signOut }, `Sign out` ),
	])
}

const IndicatorLoading = ({ signedIn, loaded, syncing }) => {
	if (loaded.local === null) return `Loading cache`
	if (!loaded.gapi) return `Loading gapi`
	if (!loaded.auth2) return `Loading auth2 api`
	if (!loaded.gapiInit) return `Connecting to gapi`
	if (signedIn === null) return `Loading sign in`
	if (signedIn === false) return `Not signed in`
	if (!loaded.spreadsheet) return `Loading data`
	if (syncing > 0) return `Saving ${syncing} ${syncing === 1 ? `change` :`changes`}`
	return null
}

const SearchHead = () => {
	return h (`div`, { class: `Head PersonRow` }, [
		h (`span`, { class: `Cell PersonName` }, `Name`),
		h (`span`, { class: `Cell PersonPhone` }, `Phone`),
		h (`span`, { class: `Cell PersonRole` }, `Role`),
		h (`span`, { class: `Cell PersonNote` }, `Note`),
		h (`div`, { class: `PersonMemberships` }, [
			h (`div`, { class: `Row MembershipRow`, current: `true` }, [
				h (`span`, { class: `Cell MembershipPlan` }, `Plan`),
				h (`span`, { class: `Cell MembershipStart` }, `Start`),
				h (`span`, { class: `Cell MembershipEnd` }, `End`),
				h (`span`, { class: `Cell MembershipRenewal` }, `Renew`),
				h (`span`, { class: `Cell MembershipProblem` }, `Check in`),
			]),
		]),
	])
}

const Search = () => {
	const people = useSelector (s => s.rows.people)
	const search = useSelector (s => s.search)
	const matches = people.filter (person => {
		if (person.name.toLowerCase ().indexOf (search.toLowerCase ()) !== -1) return true
		if (person.phone.indexOf (search) !== -1) return true
		return false
	})
	return h (`div`, { class: `Search` }, [
		...matches.slice (0, 20).map (({ index }) => {
			return h (PersonRow, { key: index, index })
		})
	])
}

const PersonRow = ({ index }) => {
	const person = useSelector (s => s.rows.people [index])
	const attendanceIndexes = useSelector (s => s.indexes.attendanceByPerson [person.id] || [])

	return h (`div`, { class: `Row PersonRow` }, [
		h (`span`, { class: `Cell PersonName` }, person.name),
		h (`span`, { class: `Cell PersonPhone` }, person.phone),
		h (`span`, { class: `Cell PersonRole` }, person.role),
		h (`span`, { class: `Cell PersonNote` }, person.note),
		/*h (`button`, { class: `Cell PersonEdit` }, `Add membership`),*/
		h (PersonMemberships, { id: person.id }),
	])
}

const PersonMemberships = ({ id }) => {
	const membershipIndexes = useSelector (s => s.indexes.membershipsByPerson [id] || [])
	const memberships = useSelector (s => membershipIndexes.map (i => s.rows.memberships [i]))
	const sortedMemberships = memberships.sort ((a, b) => {
		a = fromDate (a.start), b = fromDate (b.start)
		return a < b ? 1 : a > b ? -1 : 0
	})

	return h (`div`, { class: `PersonMemberships` }, sortedMemberships.map (({ index }) => {
		return h (MembershipRow, { key: index, index })
	}))
}

const MembershipRow = ({ index }) => {
	const membership = useSelector (s => s.rows.memberships [index])
	const current = !membership.end || fromDate (membership.end) < todayDate ()
	const canCheckIn = !!current && !membership.problem

	const dispatch = useDispatch ()

	const checkIn = useCallback (() => {
		const row = { person: membership.person, date: todayDate (), time: nowTime () }
		dispatch ({ type: `APPEND`, sheet: `Attendance`, row })
	}, [ dispatch, membership.person ])

	return h (`div`, { class: `Row MembershipRow`, current: current ? `true` : null }, [
		h (`span`, { class: `Cell MembershipPlan` }, membership.plan),
		h (`span`, { class: `Cell MembershipStart` }, membership.start),
		h (`span`, { class: `Cell MembershipEnd` }, membership.end),
		h (`span`, { class: `Cell MembershipRenewal` }, membership.renewal && `(${ordinal (membership.renewal)})`),
		canCheckIn || h (`span`, { class: `Cell MembershipProblem` }, membership.problem),
		canCheckIn && h (`span`, { class: `Cell MembershipChecks` }, [
			h (`button`, { class: `Cell MembershipCheckIn`, onClick: checkIn }, `Check in`),
		]),
	])
}

document.addEventListener (`readystatechange`, ev => {
	if (document.readyState === `interactive`) {
		const wrapper = document.createElement (`div`)
		wrapper.setAttribute (`class`, `Wrapper`)
		render (h (Provider, { store }, h (Wrapper)), wrapper)
		document.body.appendChild (wrapper)
	}
})
