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

		// Throttled persistence to DB (Full Snapshot)
		const saveToDb = throttle(async () => {
			if (isUpdatingFromRemote.current) return
			const snapshot = getSnapshot(store)
			try {
				await fetch('/api/drawing', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ id: DRAWING_ID, snapshot }),
				})
				console.log('PusherPersistence: Saved full snapshot to DB')
			} catch (err) {
				console.error('PusherPersistence: DB Save Error:', err)
			}
		}, 3000)

		// Throttled Broadcast of Diffs
		let pendingChanges: any = { added: {}, updated: {}, removed: {} }
		
		const flushBroadcast = throttle(async () => {
			const socketId = pusherRef.current?.connection.socket_id
			const changesToSend = { ...pendingChanges }
			pendingChanges = { added: {}, updated: {}, removed: {} }

			if (
				Object.keys(changesToSend.added).length === 0 &&
				Object.keys(changesToSend.updated).length === 0 &&
				Object.keys(changesToSend.removed).length === 0
			) return

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
		}, 60) // High frequency for smooth sync

		const unsubscribe = store.listen((update) => {
			if (update.source === 'user') {
				// Accumulate only relevant changes (shapes, assets, etc.)
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
					if ((record as any).typeName === 'shape' || (record as any).typeName === 'asset') {
						pendingChanges.removed[id] = record
					}
				}

				flushBroadcast()
				saveToDb()
			}
		}, { scope: 'document' })

		return () => {
			unsubscribe()
		}
	}, [store, loadingState.status])

	return { store, loadingState }
}
