import { createTLStore, defaultShapeUtils, getSnapshot, throttle } from 'tldraw'
import { useEffect, useState, useRef, useMemo } from 'react'
import Pusher from 'pusher-js'

const PUSHER_KEY = import.meta.env.VITE_PUSHER_KEY
const PUSHER_CLUSTER = import.meta.env.VITE_PUSHER_CLUSTER
const DRAWING_ID = 'global-canvas'

export function usePusherPersistence() {
	const [store] = useState(() => createTLStore({ shapeUtils: defaultShapeUtils }))
	const [loadingState, setLoadingState] = useState<{ status: 'loading' | 'ready' | 'error'; error?: string }>({
		status: 'loading',
	})
	
	const pusherRef = useRef<Pusher | null>(null)
	const isUpdatingFromRemote = useRef(false)
	const isDirtyRef = useRef(false)
	const pendingChangesRef = useRef<any>({ added: {}, updated: {}, removed: {} })

	// --- Throttled Functions (Memoized for stability) ---
	
	const saveToDb = useMemo(() => throttle(async (snapshot: any, isImmediate = false) => {
		if (isUpdatingFromRemote.current && !isImmediate) return
		
		console.log('PusherPersistence: Saving to DB...', isImmediate ? '(Immediate/Asset)' : '')
		try {
			const response = await fetch('/api/pusher-trigger', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ 
					id: DRAWING_ID, 
					snapshot, 
					triggerReload: isImmediate,
					socketId: pusherRef.current?.connection.socket_id 
				}),
			})
			
			if (response.ok) {
				isDirtyRef.current = false
				console.log('PusherPersistence: DB Save Successful')
			} else {
				const err = await response.json()
				console.error('PusherPersistence: DB Save Failed:', err)
			}
		} catch (err) {
			console.error('PusherPersistence: DB Save Network Error:', err)
		}
	}, 3000), [])

	const broadcastDiff = useMemo(() => throttle(async (changes: any) => {
		const socketId = pusherRef.current?.connection.socket_id
		if (
			Object.keys(changes.added).length === 0 &&
			Object.keys(changes.updated).length === 0 &&
			Object.keys(changes.removed).length === 0
		) return

		try {
			await fetch('/api/pusher-trigger', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: DRAWING_ID, changes, socketId }),
			})
		} catch (err) {
			console.error('PusherPersistence: Broadcast Error:', err)
		}
	}, 60), [])

	// --- Effects ---

	useEffect(() => {
		async function loadFromDb(isReload = false) {
			try {
				if (isReload) console.log('PusherPersistence: Reloading from DB...')
				const response = await fetch(`/api/drawing?id=${DRAWING_ID}`)
				if (response.ok) {
					const snapshot = await response.json()
					if (snapshot) {
						isUpdatingFromRemote.current = true
						store.loadSnapshot(snapshot)
						isUpdatingFromRemote.current = false
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
					saveToDb(getSnapshot(store), true)
				} else {
					const diff = { ...pendingChangesRef.current }
					pendingChangesRef.current = { added: {}, updated: {}, removed: {} }
					broadcastDiff(diff)
					saveToDb(getSnapshot(store))
				}
			}
		}, { scope: 'document' })

		// Flush unsaved changes on refresh/close
		const handleBeforeUnload = (e: BeforeUnloadEvent) => {
			if (isDirtyRef.current) {
				saveToDb(getSnapshot(store), true) // Try one last save
				e.preventDefault()
				e.returnValue = ''
			}
		}
		window.addEventListener('beforeunload', handleBeforeUnload)

		return () => {
			unsubscribe()
			window.removeEventListener('beforeunload', handleBeforeUnload)
		}
	}, [store, loadingState.status, saveToDb, broadcastDiff])

	return { store, loadingState }
}
