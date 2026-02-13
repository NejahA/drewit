import { createTLStore, defaultShapeUtils, getSnapshot } from 'tldraw'
import { useEffect, useState, useRef, useCallback } from 'react'
import Pusher from 'pusher-js'

const PUSHER_KEY = import.meta.env.VITE_PUSHER_KEY
const PUSHER_CLUSTER = import.meta.env.VITE_PUSHER_CLUSTER
const DRAWING_ID = 'global-canvas'

// Custom throttler that ensures the LAST call is always executed (trailing edge)
function createThrottler(delay: number) {
	let lastCall = 0
	let timeout: any = null
	let pendingArgs: any[] | null = null

	return function(fn: (...args: any[]) => void) {
		return function(this: any, ...args: any[]) {
			const now = Date.now()
			pendingArgs = args

			const execute = () => {
				lastCall = Date.now()
				timeout = null
				if (pendingArgs) {
					fn.apply(this, pendingArgs)
					pendingArgs = null
				}
			}

			if (now - lastCall >= delay) {
				if (timeout) clearTimeout(timeout)
				execute()
			} else if (!timeout) {
				timeout = setTimeout(execute, delay - (now - lastCall))
			}
		}
	}
}

export function usePusherPersistence() {
	const [store] = useState(() => createTLStore({ shapeUtils: defaultShapeUtils }))
	const [loadingState, setLoadingState] = useState<{ status: 'loading' | 'ready' | 'error'; error?: string }>({
		status: 'loading',
	})
	
	const pusherRef = useRef<Pusher | null>(null)
	const isUpdatingFromRemote = useRef(false)
	const isDirtyRef = useRef(false)
	const pendingChangesRef = useRef<any>({ added: {}, updated: {}, removed: {} })

	// --- Core Persistence Logic ---

	const doSaveToDb = useCallback(async (isImmediate = false) => {
		if (!isDirtyRef.current || (isUpdatingFromRemote.current && !isImmediate)) return
		
		const snapshot = getSnapshot(store)
		if (!snapshot || Object.keys(snapshot.store).length === 0) {
			console.warn('PusherPersistence: Skipping save of empty snapshot')
			return
		}

		console.log('PusherPersistence: Saving to DB...', isImmediate ? '(Immediate)' : '')
		
		try {
			const response = await fetch('/api/drawing', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: DRAWING_ID, snapshot }),
			})
			
			if (response.ok) {
				isDirtyRef.current = false
				console.log('PusherPersistence: DB Save Successful')
				
				if (isImmediate) {
					fetch('/api/pusher-trigger', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ 
							id: DRAWING_ID, 
							triggerReload: true, 
							socketId: pusherRef.current?.connection.socket_id 
						}),
					}).catch(console.error)
				}
			} else {
				console.error('PusherPersistence: DB Save Failed:', await response.text())
			}
		} catch (err) {
			console.error('PusherPersistence: DB Save Network Error:', err)
		}
	}, [store])

	const throttledSave = useRef(createThrottler(3000)(doSaveToDb)).current
	
	const throttledBroadcast = useRef(createThrottler(60)(async (changes: any) => {
		try {
			await fetch('/api/pusher-trigger', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ 
					id: DRAWING_ID, 
					changes, 
					socketId: pusherRef.current?.connection.socket_id 
				}),
			})
		} catch (err) {
			console.error('PusherPersistence: Broadcast Error:', err)
		}
	})).current

	// --- Effects ---

	useEffect(() => {
		async function loadFromDb(isReload = false) {
			try {
				if (isReload) console.log('PusherPersistence: Reloading from DB...')
				const response = await fetch(`/api/drawing?id=${DRAWING_ID}`)
				if (response.ok) {
					const snapshot = await response.json()
					if (snapshot && Object.keys(snapshot.store).length > 0) {
						isUpdatingFromRemote.current = true
						store.loadSnapshot(snapshot)
						isUpdatingFromRemote.current = false
						console.log('PusherPersistence: Loaded store from DB')
					} else {
						console.log('PusherPersistence: DB empty or null, keeping local state')
					}
				}
				setLoadingState({ status: 'ready' })
			} catch (err: any) {
				console.error('PusherPersistence: Load error:', err)
				if (!isReload) setLoadingState({ status: 'error', error: err.message })
			}
		}
		loadFromDb()

		if (!PUSHER_KEY || !PUSHER_CLUSTER) return
		const pusher = new Pusher(PUSHER_KEY, { cluster: PUSHER_CLUSTER })
		pusherRef.current = pusher
		const channel = pusher.subscribe(`drawing-${DRAWING_ID}`)
		
		channel.bind('drawing-diff', (data: { changes: any }) => {
			isUpdatingFromRemote.current = true
			store.mergeRemoteChanges(() => {
				const { added, updated, removed } = data.changes
				for (const [id, _] of Object.entries(removed)) store.remove([id as any])
				const toPut = [
					...Object.values(added),
					...Object.values(updated).map((u: any) => u[1])
				]
				if (toPut.length > 0) store.put(toPut as any[])
			})
			isUpdatingFromRemote.current = false
		})

		channel.bind('drawing-reload', () => loadFromDb(true))

		return () => {
			pusher.unsubscribe(`drawing-${DRAWING_ID}`)
			pusher.disconnect()
		}
	}, [store])

	useEffect(() => {
		if (loadingState.status !== 'ready') return

		const unsubscribe = store.listen((update) => {
			if (update.source === 'user') {
				isDirtyRef.current = true
				let hasAsset = false

				for (const [id, record] of Object.entries(update.changes.added)) {
					const type = (record as any).typeName
					if (type === 'shape' || type === 'asset') {
						pendingChangesRef.current.added[id] = record
						if (type === 'asset') hasAsset = true
					}
				}
				for (const [id, record] of Object.entries(update.changes.updated)) {
					const newVal = record[1]
					const type = (newVal as any).typeName
					if (type === 'shape' || type === 'asset') {
						pendingChangesRef.current.updated[id] = record
						if (type === 'asset') hasAsset = true
					}
				}
				for (const [id, record] of Object.entries(update.changes.removed)) {
					if ((record as any).typeName === 'shape' || (record as any).typeName === 'asset') {
						pendingChangesRef.current.removed[id] = record
					}
				}

				if (hasAsset) {
					doSaveToDb(true)
				} else {
					const diff = { ...pendingChangesRef.current }
					pendingChangesRef.current = { added: {}, updated: {}, removed: {} }
					throttledBroadcast(diff)
					throttledSave()
				}
			}
		}, { scope: 'document' })

		const handleBeforeUnload = () => {
			if (isDirtyRef.current) {
				const snapshot = getSnapshot(store)
				if (snapshot && Object.keys(snapshot.store).length > 0) {
					const blob = new Blob([JSON.stringify({ id: DRAWING_ID, snapshot })], { type: 'application/json' })
					navigator.sendBeacon('/api/drawing', blob)
				}
			}
		}
		window.addEventListener('beforeunload', handleBeforeUnload)

		return () => {
			unsubscribe()
			window.removeEventListener('beforeunload', handleBeforeUnload)
		}
	}, [store, loadingState.status, doSaveToDb, throttledSave, throttledBroadcast])

	return { store, loadingState }
}
