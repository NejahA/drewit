import { createTLStore, defaultShapeUtils, getSnapshot, throttle } from 'tldraw'
import { useEffect, useState, useRef } from 'react'
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

	useEffect(() => {
		// 1. Initial Load from DB
		async function loadInitial() {
			try {
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
				console.error('PusherPersistence: Initial load error:', err)
				setLoadingState({ status: 'error', error: err.message })
			}
		}
		loadInitial()

		// 2. Pusher Setup
		if (!PUSHER_KEY || !PUSHER_CLUSTER) return

		const pusher = new Pusher(PUSHER_KEY, { cluster: PUSHER_CLUSTER })
		pusherRef.current = pusher

		const channel = pusher.subscribe(`drawing-${DRAWING_ID}`)
		
		channel.bind('drawing-diff', (data: { changes: any }) => {
			console.log('PusherPersistence: Received incremental sync')
			isUpdatingFromRemote.current = true
			store.mergeRemoteChanges(() => {
				const { added, updated, removed } = data.changes
				
				// Apply removals
				for (const [id, _] of Object.entries(removed)) {
					store.remove([id as any])
				}
				
				// Apply additions and updates
				const toPut = [
					...Object.values(added),
					...Object.values(updated).map((u: any) => u[1]) // updated is [old, new]
				]
				
				if (toPut.length > 0) {
					store.put(toPut as any[])
				}
			})
			isUpdatingFromRemote.current = false
		})

		return () => {
			pusher.unsubscribe(`drawing-${DRAWING_ID}`)
			pusher.disconnect()
		}
	}, [store])

	useEffect(() => {
		if (loadingState.status !== 'ready') return

		const saveSnapshot = async () => {
			if (isUpdatingFromRemote.current) return
			const snapshot = getSnapshot(store) as any
			
			// Don't save if it's completely empty (unless it was already empty)
			if (!snapshot.store || Object.keys(snapshot.store).length < 5) {
				console.warn('PusherPersistence: Skipping save - Store seems empty')
				return
			}

			try {
				await fetch('/api/drawing', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ id: DRAWING_ID, snapshot }),
				})
				console.log('PusherPersistence: Saved snapshot to MongoDB')
			} catch (err) {
				console.error('PusherPersistence: DB Save Error:', err)
			}
		}

		// Throttled persistence to DB
		const throttledSave = throttle(saveSnapshot, 2000)

		// Throttled Broadcast of Diffs
		let pendingChanges: any = { added: {}, updated: {}, removed: {} }
		
		const flushBroadcast = throttle(async () => {
			const socketId = pusherRef.current?.connection.socket_id
			const changesToSend = { ...pendingChanges }
			pendingChanges = { added: {}, updated: {}, removed: {} }

			const hasChanges = Object.keys(changesToSend.added).length > 0 ||
							   Object.keys(changesToSend.updated).length > 0 ||
							   Object.keys(changesToSend.removed).length > 0

			if (!hasChanges) return

			try {
				await fetch('/api/pusher-trigger', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ 
						id: DRAWING_ID, 
						changes: changesToSend,
						socketId 
					}),
				})
			} catch (err) {
				console.error('PusherPersistence: Broadcast Error:', err)
			}
		}, 60)

		const unsubscribe = store.listen((update) => {
			// Prevent feedback loops: don't broadcast or save if the update came from Pusher
			if (update.source === 'remote') return

			// 1. Accumulate diffs for Pusher (Shapes & Assets only)
			for (const [id, record] of Object.entries(update.changes.added)) {
				if ((record as any).typeName === 'shape' || (record as any).typeName === 'asset') {
					pendingChanges.added[id] = record
				}
			}
			for (const [id, record] of Object.entries(update.changes.updated)) {
				const newVal = record[1]
				if ((newVal as any).typeName === 'shape' || (newVal as any).typeName === 'asset') {
					pendingChanges.updated[id] = record
				}
			}
			for (const [id, record] of Object.entries(update.changes.removed)) {
				const [id_] = id.split(':')
				if (id_ === 'shape' || id_ === 'asset') {
					pendingChanges.removed[id] = record
				}
			}

			flushBroadcast()
			throttledSave()
		}, { scope: 'all' })

		// Force save on window close
		const handleBeforeUnload = () => {
			saveSnapshot()
		}
		window.addEventListener('beforeunload', handleBeforeUnload)

		return () => {
			unsubscribe()
			window.removeEventListener('beforeunload', handleBeforeUnload)
		}
	}, [store, loadingState.status])

	return { store, loadingState }
}
