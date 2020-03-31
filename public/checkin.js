const { createElement: h, Fragment, useState, useReducer, useMemo, useEffect, useCallback } = React
const { render } = ReactDOM

const CLIENT_ID = `%CLIENT_ID%`
const API_KEY = `%API_KEY%`
const SCOPES = `https://www.googleapis.com/auth/spreadsheets`
const DISCOVERY_DOCS = [ `https://sheets.googleapis.com/$discovery/rest?version=v4` ]

const loadGapi = () => new Promise ((res, rej) => {
	const script = document.createElement (`script`)
	script.src = `https://apis.google.com/js/api.js`
	script.defer = true
	script.async = true
	script.addEventListener (`load`, ev => res ())
	script.addEventListener (`readystatechange`, ev => script.readyState === `complete` && res ())
	script.addEventListener (`error`, ev => rej (ev))
	document.body.appendChild (script)
})

const loadAuth2 = () => new Promise ((res, rej) => {
	gapi.load (`client:auth2`, res)
})

const initGapi = () => gapi.client.init ({
	apiKey: API_KEY,
	clientId: CLIENT_ID,
	discoveryDocs: DISCOVERY_DOCS,
	scope: SCOPES,
})

const isSignedIn = onSignIn => {
	gapi.auth2.getAuthInstance ().isSignedIn.listen (onSignIn) // listen for sign-in state changes.
	onSignIn (gapi.auth2.getAuthInstance ().isSignedIn.get ()) // handle the initial sign-in state.
}

const initiateSignIn = () => {
	gapi.auth2.getAuthInstance ().signIn ()
}

const initiateSignOut = () => {
	gapi.auth2.getAuthInstance ().signOut ()
}

const MEMBERS = {
	primaryHeadingRow: 2,
	numberOfHeadingRows: 2,
	headings: {
		id: `ID`, name: `NAME`, phone: `PHONE #`,
		plan: `PLAN`, renewalDate: `RENEWAL DATE`,
		role: `ROLE`, issues: `ISSUES`, notes: `NOTES`,
		cancelReason: `REASON FOR CANCELLATION`,
	}
}

const ATTENDANCE = {
	primaryHeadingRow: 2,
	numberOfHeadingRows: 2,
	headings: {
		member: `MEMBER`, date: `DATE`, eventType: `EVENT TYPE`,
		time: `CHECK IN TIME`, notes: `NOTES`,
	}
}

const EVENTS = {
	primaryHeadingRow: 2,
	numberOfHeadingRows: 2,
	headings: {
		date: `DATE`, type: `TYPE`,
		attendance: `ATTENDANCE`, notes: `NOTES`,
	}
}

const parseSpreadsheet = (rows, schema) => {
	if (rows.length <= schema.numberOfHeadingRows) return []

	const keysByHeading = Object.entries (schema.headings).reduce ((obj, [ key, val ]) => ({ ...obj, [val]: key }), {})
	const headingsByColumn = rows [schema.primaryHeadingRow - 1]
	const keysByColumn = headingsByColumn.map (heading => keysByHeading [heading])

	const data = []
	for (let i = schema.numberOfHeadingRows; i < rows.length; i++) {
		const row = rows [i]
		if (row.length === 0) continue
		data.push (row.reduce ((obj, value, column) => (keysByColumn [column] ? { ...obj, [keysByColumn [column]]: value } : obj), {}))
	}

	return data
}

const indexBy = (rows, key) => {
	const object = {}
	rows.forEach (row => {
		const index = row [key]
		if (object [index]) object [index].push (row)
		else object [index] = [ row ]
	})
	return object
}

const loadData = () => gapi.client.sheets.spreadsheets.values.batchGet ({
	spreadsheetId: `%SPREADSHEET_ID%`,
	ranges: [
		`Members!A:ZZ`,
		`Attendance!A:ZZ`,
	],
}).then (response => {
	const ranges = response.result.valueRanges
	const members = parseSpreadsheet (ranges [0].values, MEMBERS)
	const attendanceRows = parseSpreadsheet (ranges [1].values, ATTENDANCE)
	const attendance = indexBy (attendanceRows, `member`)
	console.log ({ members, attendance })
	return { members, attendance }
})

const appendAttendance = (member, date, time) => gapi.client.sheets.spreadsheets.values.append ({
	spreadsheetId: `%SPREADSHEET_ID%`,
	range: `Attendance!A:ZZ`,
	valueInputOption: `USER_ENTERED`,
	insertDataOption: `INSERT_ROWS`,
	includeValuesInResponse: true,
	resource: { values: [
		[ member, `=VLOOKUP(A:A,Members!$A:$B,2,false)`, date, `=VLOOKUP(C:C,Events!$A:$B,2,false)`, time ],
	] },
}).then (response => {
})

const useLoad = (loader, deps) => {
	const [ loaded, setLoaded ] = useState (false)
	useMemo (() => {
		for (let i = 0; i < deps.length; i++) if (!deps [i]) {
			if (loaded) setLoaded (false)
			return
		}
		const promise = loader ()
		if (!promise) {
			setLoaded (true)
			return
		}
		promise.then (() => setLoaded (true), console.error)
	}, deps)
	return loaded
}

const toDate = timestamp => {
	const date = new Date (timestamp - 1000 * 60 * 60 * 4)
	return `${date.getDate ()}/${date.getMonth () + 1}/${date.getFullYear ()}`
}

const toTime = timestamp => {
	const time = new Date (timestamp)
	return `${(time.getHours () % 12 || 12) + 1}:${time.getMinutes ()}:${time.getSeconds ()} ${time.getHours () < 12 ? `AM` : `PM`}`
}

const fromTime = time => new Date (`${time} ${dateNow ()}`) * 1
const fromDate = date => new Date (`00:00:00 ${date}`) * 1

const dateToday = () => toDate (Date.now () - 1000 * 60 * 60 * 4)
const timeNow = () => toTime (Date.now ())

const SearchRow = ({ member, dates = [], dispatch }) => {
	const hereToday = useCallback (() => {
		const date = { member: member.id, date: dateToday (), time: timeNow () }
		appendAttendance (member.id, date.date, date.time).then (() => {
			dispatch ({ type: `HERE_TODAY`, member: member.id, date })
		}, console.error)
	}, [ member.id ])

	return h (`div`, {}, [
		member.name,
		h (`div`, {}, [
			dates.map (date => date.date).join (`, `),
		]),
		h (`br`),
		dates.find (date => date.date === dateToday ()) ? h (`button`, { disabled: true }, `Already checked in`) : h (`button`, { onClick: hereToday }, `Check in today`),
		h (`hr`),
	])
}

const SearchBox = ({ members, attendance, dispatch }) => {
	const [ search, onSearch ] = useState (``)
	const onChange = useCallback (ev => onSearch (ev.target.value), [ onSearch ])

	const matches = search.length >= 1 ? members.filter (member => {
		if (member.name.toLowerCase ().indexOf (search.toLowerCase ()) !== -1) return true
		if (member.phone.indexOf (search) !== -1) return true
		return false
	}) : []

	return [
		h (`input`, { placeholder: `Name or phone #`, onChange, value: search }),
		...matches.slice (0, 10).map (member => h (SearchRow, { key: member.id, member, dates: attendance [member.id], dispatch })),
	]
}

const Search = ({ data, dispatch }) => {
	const { members, attendance } = data
	return [
		`Search ${members.length} membership records here`,
		h (`button`, { onClick: initiateSignOut }, `Sign out` ),
		h (`hr`),
		h (SearchBox, { members, attendance, dispatch }),
	]
}

const reducer = (state, action) => { switch (action.type) {
	case `LOAD`:
		return {
			...state,
			loaded: true, members: action.data.members, attendance: action.data.attendance
		}
	case `HERE_TODAY`:
		return {
			...state,
			attendance: {
				...state.attendance,
				[action.member]: [ ...state.attendance [action.member] || [], action.date ],
			}
		}
	default:
		throw new Error (`${action.type} is an invalid action type to dispatch`)
} }

const Wrapper = () => {
	const gapiLoaded = useLoad (loadGapi, [])
	const auth2Loaded = useLoad (loadAuth2, [ gapiLoaded ])
	const gapiInited = useLoad (initGapi, [ auth2Loaded ])
	const [ signedIn, setSignedIn ] = useState (false)
	useLoad (() => isSignedIn (setSignedIn), [ gapiInited ])
	const [ data, dispatch ] = useReducer (reducer, { loaded: false })
	useLoad (() => loadData ().then (data => dispatch ({ type: `LOAD`, data })), [ signedIn ])

	if (!gapiLoaded) return `Loading gapi`
	if (!auth2Loaded) return `Loading auth2 api`
	if (!gapiInited) return `Initing gapi`
	if (!signedIn) return [ `Sign in now`, h (`button`, { onClick: initiateSignIn }, `Sign in` ) ]
	if (!data.loaded) return `Loading data`
	return h (Search, { data, dispatch })
}

document.addEventListener (`readystatechange`, ev => {
	if (document.readyState === `interactive`) {
		const wrapper = document.createElement (`div`)
		render (h (Wrapper), wrapper)
		document.body.appendChild (wrapper)
	}
})
