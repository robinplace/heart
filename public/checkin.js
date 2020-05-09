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
const { Provider, useSelector, shallowEqual, useDispatch } = ReactRedux
const useShallowSelector = selector => useSelector (selector, shallowEqual)

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
	case `SYNCED`: return s.filter (aa => aa !== a.action)
	case `APPEND`: case `UPDATE`: return [ ...s, a ]
	default: return s
} }
const rowsReducer = (s = {}, a) => { switch (a.type) {
	case `LOADED`: return a.payload.rows || s
	case `APPEND`: return { ...s, [a.sheet]: [ ...s [a.sheet], { ...a.row, index: s [a.sheet].length } ] }
	case `UPDATE`: return { ...s, [a.sheet]: [ ...s [a.sheet].map (r => r.index === a.index ? { ...r, [a.column]: a.value } : r) ] }
	default: return s
} }
const keysByOffsetReducer = (s = {}, a) => { switch (a.type) {
	case `LOADED`: return a.payload.keysByOffset || s
	default: return s
} }
const searchReducer = (s = ``, a) => { switch (a.type) {
	case `SEARCH`: return a.search
	default: return s
} }

const store = createStore (combineReducers ({
	loaded: loadedReducer,
	signedIn: signedInReducer,
	syncQueue: syncQueueReducer,
	rows: rowsReducer,
	keysByOffset: keysByOffsetReducer,
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
	keysByOffset: {
		people: {},
		memberships: {},
		plans: {},
		attendance: {},
		events: {},
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

const uuid = (length = 5) => {
	let uuid = ``
	for (let i = 0; i < length; i++) uuid += (~~ (Math.random () * 26)).toString (26)
	return uuid
}

const parseSheet = ({ values }) => {
	if (values.length <= FROZEN_ROWS) return { rows: [], keysByOffset: [] }

	const keysByOffset = values [FROZEN_ROWS - 1]
	// prefers the first occurrence of a key
	const offsetsByKey = keysByOffset.reduce ((offsets, key, offset) => ({ [key]: offset, ...offsets }), {})

	const rows = []
	for (let i = FROZEN_ROWS; i < values.length; i++) {
		const row = values [i]
		if (row.length === 0) continue
		rows.push (row.reduce ((rows, value, offset) => {
			const key = keysByOffset [offset]
			if (!key) return rows
			// again, prefer the first occurrence
			return { [key]: value, ...rows }
		}, { index: rows.length }))
	}

	return { rows, keysByOffset }
}

const lettersByColumn = `ABCDEFGHIJKLMNOPQRSTUVWXYZ`.split (``)

// not gonna prematurely optimize
/*const indexBy = (rows, key) => {
	const object = {}
	rows.forEach (row => {
		const index = row [key]
		if (object [index]) object [index].push (row.index)
		else object [index] = [ row.index ]
	})
	return object
}*/

const d = new Date ()
const toDate = timestamp => {
	return timestamp
	d.setTime (timestamp)
	return d.toLocaleDateString (`en-US`, { month: `2-digit`, day: `2-digit`, year: `numeric` })
}
const toTime = timestamp => {
	return timestamp
	d.setTime (timestamp)
	return d.toLocaleTimeString (`en-US`, { hour: `numeric`, minute: `2-digit`, second: `2-digit`, hour12: true })
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
			`people!A:ZZ`,
			`memberships!A:ZZ`,
			`plans!A:ZZ`,
			`attendance!A:ZZ`,
			`events!A:ZZ`,
		],
	}).then (response => {
		const ranges = response.result.valueRanges
		const [ rows, keysByOffset ] = [
			`people`, `memberships`, `plans`, `attendance`, `events`
		].reduce (([ rows, keysByOffset ], name, i) => {
			const sheet = parseSheet (ranges [i])
			return [
				{ ...rows, [name]: sheet.rows },
				{ ...keysByOffset, [name]: sheet.keysByOffset },
			]
		}, [ {}, {} ])
		return { rows, keysByOffset }
	}),
})

const SyncWorker = () => {
	const ready = useSelector (s => s.loaded.spreadsheet)
	const a = useSelector (s => s.syncQueue [s.syncQueue.length - 1])
	const dispatch = useDispatch ()
	useEffect (() => {
		if (!ready || !a) {
			return
		} else if (a.type === `APPEND`) {
			const keysByOffset = store.getState ().keysByOffset [a.sheet]
			if (!keysByOffset) return
			const values = keysByOffset.map (key => key ? a.row [key] : '')
			gapi.client.sheets.spreadsheets.values.append ({
				spreadsheetId: SPREADSHEET_ID,
				range: `${a.sheet}!A:ZZ`,
				valueInputOption: `USER_ENTERED`,
				insertDataOption: `INSERT_ROWS`,
				includeValuesInResponse: true,
				resource: { values: [ values ] },
			}).then (response => dispatch ({ type: `SYNCED`, action: a }))
		} else if (a.type === `UPDATE`) {
			const keysByOffset = store.getState ().keysByOffset [a.sheet]
			if (!keysByOffset) return
			const column = keysByOffset.findIndex (key => key === a.column)
			const letter = lettersByColumn [column]
			if (!letter) return
			gapi.client.sheets.spreadsheets.values.update ({
				spreadsheetId: SPREADSHEET_ID,
				range: `${a.sheet}!${letter}${a.index + 1 + FROZEN_ROWS}`,
				valueInputOption: `USER_ENTERED`,
				resource: { values: [ [ a.value ] ] },
			}).then (response => dispatch ({ type: `SYNCED`, action: a }))
		}
	}, [ ready, a, dispatch ])
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
	const addPerson = useCallback (() => dispatch ({ type: `APPEND`, sheet: `people`, row: { id: uuid (5), name: `First Last`, phone: `Phone`, note: `` } }))
	return h (`div`, { class: `SearchBox` }, [
		h (SearchInput),
		h (`button`, { onClick: addPerson }, `Add person`),
		h (CheckInCount),
	])
}

const CheckInCount = () => {
	const attendance = useSelector (s => s.rows.attendance)
	const today = todayDate ()
	const count = attendance.filter (r => r.date === today).length
	return h (`span`, {}, `${count} ${count === 1 ? `person` : `people`} checked in today`)
}

const SearchInput = () => {
	const dispatch = useDispatch ()
	const search = useSelector (s => s.search)
	const setSearch = useCallback (ev => dispatch ({ type: `SEARCH`, search: ev.target.value }), [ dispatch ])
	return h (`input`, { class: `SearchInput`, placeholder: `Search by name or phone #`, onInput: setSearch, value: search })
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
		h (`span`, { class: `Cell`, sheet: `people`, column: `name` }, `Name`),
		h (`span`, { class: `Cell`, sheet: `people`, column: `phone` }, `Phone`),
		h (`span`, { class: `Cell`, sheet: `people`, column: `note` }, `Note`),
		h (`div`, { class: `Cell`, sheet: `people`, column: `memberships` }, [
			h (`div`, { class: `Row`, sheet: `memberships` }, [
				h (`span`, { class: `Cell`, sheet: `memberships`, column: `plan` }, `Plan`),
				h (`span`, { class: `Cell`, sheet: `memberships`, column: `start` }, `Start`),
				h (`span`, { class: `Cell`, sheet: `memberships`, column: `end` }, `End`),
				h (`span`, { class: `Cell`, sheet: `memberships`, column: `renewal` }, `Renew`),
				h (`span`, { class: `Cell`, sheet: `memberships`, column: `checkin` }, `Check in`),
				h (`span`, { class: `Cell`, sheet: `memberships`, column: `note` }, `Note`),
			]),
		]),
	])
}

const Search = () => {
	const people = useSelector (s => s.rows.people)
	const search = useSelector (s => s.search)
	const matches = people.filter (person => {
		if (person.name && person.name.toLowerCase ().indexOf (search.toLowerCase ()) !== -1) return true
		if (person.phone && person.phone.indexOf (search) !== -1) return true
		return false
	})
	matches.reverse ()
	return h (`div`, { class: `Search` }, [
		...matches.slice (0, 20).map (({ index }) => {
			return h (PersonRow, { key: index, index })
		})
	])
}

const PersonRow = ({ index }) => {
	const person = useSelector (s => s.rows.people [index])
	const attendance = useShallowSelector (s => s.rows.attendance.filter (r => r.person === person.id))
	const today = todayDate ()
	const checkedIn = !!attendance.find (r => r.date === today)

	return h (`div`, { class: `Row PersonRow` }, [
		h (EditCell, { sheet: `people`, index, column: `name` }),
		h (EditCell, { sheet: `people`, index, column: `phone` }),
		h (EditCell, { sheet: `people`, index, column: `note` }),
		h (PersonMemberships, { id: person.id, checkedIn }),
	])
}

const PersonMemberships = ({ id, checkedIn }) => {
	const memberships = useShallowSelector (s => s.rows.memberships.filter (r => r.person === id))

	const dispatch = useDispatch ()

	const newMembership = useCallback (() => {
		const defaultPlan = store.getState ().rows.plans [0]
		const row = { person: id, plan: defaultPlan.id, price: defaultPlan.price, start: todayDate (), end: ``, renewal: `` }
		dispatch ({ type: `APPEND`, sheet: `memberships`, row })
	}, [ dispatch, id ])

	if (memberships.length === 0) return h (`div`, { class: `Cell`, sheet: `people`, column: `memberships` }, [
		h (`div`, { class: `Row`, sheet: `memberships`, current: null }, [
			h (Cell, { sheet: `memberships`, column: `checkin` }, `NO MEMBERSHIP`),
			h (ButtonCell, { sheet: `memberships`, column: `newmembership`,
				onClick: newMembership }, `New membership`),
		]),
	])

	const sortedMemberships = memberships.sort ((a, b) => {
		a = fromDate (a.start), b = fromDate (b.start)
		return a < b ? 1 : a > b ? -1 : 0
	})

	return h (`div`, { class: `Cell`, sheet: `people`, column: `memberships` }, sortedMemberships.map (({ index }, i) => {
		return h (MembershipRow, { key: index, index, checkedIn, first: i === 0, newMembership })
	}))
}

const MembershipRow = ({ index, first, checkedIn, newMembership }) => {
	const membership = useSelector (s => s.rows.memberships [index])
	const current = !membership.end || (fromDate (membership.end) + 1000 * 60 * 60 * 24 >= Date.now () - 1000 * 60 * 60 * 4)
	const canCheckIn = !!current
	const showNew = !current && first

	const dispatch = useDispatch ()

	const checkIn = useCallback (() => {
		const row = { person: membership.person, date: todayDate (), time: nowTime () }
		dispatch ({ type: `APPEND`, sheet: `attendance`, row })
	}, [ dispatch, membership.person ])

	return h (`div`, { class: `Row`, sheet: `memberships`, current: current ? `true` : null }, [
		h (EditCell, { sheet: `memberships`, index, column: `plan` }),
		h (EditCell, { sheet: `memberships`, index, column: `start`,
			prettify: d => isNaN (new Date (d)) ? d : toDate (d) }),
		h (EditCell, { sheet: `memberships`, index, column: `end`,
			prettify: d => isNaN (new Date (d)) ? d : toDate (d) }),
		h (EditCell, { sheet: `memberships`, index, column: `renewal`,
			prettify: v => v ? ordinal (v) : `` }),
		!canCheckIn && first && h (Cell, { sheet: `memberships`, column: `checkin` }, `MEMBERSHIP ISSUE TALK TO HOST`),
		!canCheckIn && !first && h (Cell, { sheet: `memberships`, column: `checkin` }, `INACTIVE`),
		canCheckIn && checkedIn && h (ButtonCell, { sheet: `memberships`, column: `checkin`,
			disabled: true }, `\u2714\uFE0F Checked in`),
		canCheckIn && !checkedIn && h (ButtonCell, { sheet: `memberships`, column: `checkin`,
			onClick: checkIn }, `\u{1F449} Check in`),
		h (EditCell, { sheet: `memberships`, index, column: `note` }),
		showNew && h (ButtonCell, { sheet: `memberships`, column: `newmembership`,
			onClick: newMembership }, `New membership`),
	])
}

const Cell = ({ sheet, column, children }) => {
	return h (`span`, { class: `Cell`, sheet, column }, children)
}

const EditCell = ({ sheet, index, column, prettify }) => {
	const value = useSelector (s => s.rows [sheet] [index] [column])
	const [ editing, setEditing ] = useState (false)
	const [ temp, setTemp ] = useState (``)
	const input = useCallback (ev => setTemp (ev.target.value), [ setTemp ])
	const startEditing = useCallback (() => {
		setTemp (value)
		setEditing (true)
	}, [ value, setEditing ])
	const dispatch = useDispatch ()
	const stopEditing = useCallback (() => {
		if (value !== temp) dispatch ({ type: `UPDATE`, sheet, index, column, value: temp })
		setEditing (false)
	}, [ dispatch, sheet, index, column, temp, setEditing ])
	const inputRef = useRef (null)
	useEffect (() => { editing && inputRef.current.select () }, [ editing ])

	if (editing) {
		return h (`form`, { class: `Cell`, sheet, column, onSubmit: stopEditing }, [
			h (`input`, { ref: inputRef, value: temp, onInput: input, onBlur: stopEditing })
		])
	} else {
		const pretty = prettify ? prettify (value) : value
		return h (`span`, { class: `Cell`, sheet, column,
			onDoubleClick: startEditing }, pretty)
	}
}

const ButtonCell = ({ sheet, column, disabled, onClick, children }) => {
	return h (`button`, { class: `Cell`, sheet, column, disabled, onClick }, children)
}

document.addEventListener (`readystatechange`, ev => {
	if (document.readyState === `interactive`) {
		const wrapper = document.createElement (`div`)
		wrapper.setAttribute (`class`, `Wrapper`)
		render (h (Provider, { store }, h (Wrapper)), wrapper)
		document.body.appendChild (wrapper)
	}
})
