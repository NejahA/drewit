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
		// 1. Load from DB (Reusable)
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

		// 2. Pusher Setup
		if (!PUSHER_KEY || !PUSHER_CLUSTER) return

		const pusher = new Pusher(PUSHER_KEY, { cluster: PUSHER_CLUSTER })
		pusherRef.current = pusher

		const channel = pusher.subscribe(`drawing-${DRAWING_ID}`)
		
		// Handle Incremental Diffs
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

		// Handle Full Reload Signal (for large assets)
		channel.bind('drawing-reload', () => {
			loadFromDb(true)
		})

		return () => {
			pusher.unsubscribe(`drawing-${DRAWING_ID}`)
			pusher.disconnect()
		}
	}, [store])

	useEffect(() => {
		if (loadingState.status !== 'ready') return

		// Throttled persistence to DB (Full Snapshot)
		const saveToDb = throttle(async (isImmediate = false) => {
			if (isUpdatingFromRemote.current && !isImmediate) return
			const snapshot = getSnapshot(store)
			const socketId = pusherRef.current?.connection.socket_id
			try {
				await fetch('/api/pusher-trigger', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ 
						id: DRAWING_ID, 
						snapshot, 
						triggerReload: isImmediate,
						socketId 
					}),
				})
				console.log('PusherPersistence: Saved full snapshot to DB', isImmediate ? '(Immediate/Asset)' : '')
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
				let hasAsset = false

				// Accumulate only relevant changes (shapes, assets, etc.)
				for (const [id, record] of Object.entries(update.changes.added)) {
					const type = (record as any).typeName
					if (type === 'shape' || type === 'asset') {
						pendingChanges.added[id] = record
						if (type === 'asset') hasAsset = true
					}
				}
				for (const [id, record] of Object.entries(update.changes.updated)) {
					const newVal = record[1]
					const type = (newVal as any).typeName
					if (type === 'shape' || type === 'asset') {
						pendingChanges.updated[id] = record
						if (type === 'asset') hasAsset = true
					}
				}
				for (const [id, record] of Object.entries(update.changes.removed)) {
					if ((record as any).typeName === 'shape' || (record as any).typeName === 'asset') {
						pendingChanges.removed[id] = record
					}
				}

				// If an asset was added/updated, trigger a full DB save and reload signal
				if (hasAsset) {
					saveToDb(true) // Immediate save with reload trigger
				} else {
					flushBroadcast()
					saveToDb()
				}
			}
		}, { scope: 'document' })

		return () => {
			unsubscribe()
		}
	}, [store, loadingState.status])

	return { store, loadingState }
}
