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
			console.log('PusherPersistence: Initializing load...')
			try {
				const response = await fetch(`/api/drawing?id=${DRAWING_ID}`)
				if (response.ok) {
					const snapshot = await response.json()
					if (snapshot && snapshot.schema) {
						console.log('PusherPersistence: Valid snapshot found. Version:', snapshot.schema.schemaVersion)
						console.log('PusherPersistence: Loading snapshot into store...')
						isUpdatingFromRemote.current = true
						try {
							store.loadSnapshot(snapshot)
							console.log('PusherPersistence: Load successful!')
						} catch (e) {
							console.error('PusherPersistence: Failed to load snapshot:', e)
							console.warn('PusherPersistence: Falling back to fresh state.')
						}
						isUpdatingFromRemote.current = false
					} else {
						console.warn('PusherPersistence: Invalid or missing snapshot. Initializing fresh state...')
						// Force overwrite the bad data with a fresh snapshot immediately
						// Use serialize() instead of getSnapshot() to avoid "Session state not ready"
						const freshSnapshot = store.serialize()
						try {
							await fetch('/api/drawing', {
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({ id: DRAWING_ID, snapshot: freshSnapshot }),
							})
							console.log('PusherPersistence: Fresh snapshot initialized in DB.')
						} catch (err) {
							console.error('PusherPersistence: Failed to initialize fresh snapshot:', err)
						}
					}
				} else {
					console.error('PusherPersistence: Load failed with status:', response.status)
				}
				setLoadingState({ status: 'ready' })
			} catch (err: any) {
				console.error('PusherPersistence: Initial load error:', err)
				setLoadingState({ status: 'error', error: err.message })
			}
		}
		loadInitial()

		// 2. Pusher Setup
		if (!PUSHER_KEY || !PUSHER_CLUSTER) {
			console.warn('PusherPersistence: Missing keys, live sync disabled.')
			return
		}

		console.log('PusherPersistence: Connecting to Pusher...')
		const pusher = new Pusher(PUSHER_KEY, { cluster: PUSHER_CLUSTER })
		pusherRef.current = pusher

		const channel = pusher.subscribe(`drawing-${DRAWING_ID}`)
		
		channel.bind('drawing-diff', (data: { changes: any }) => {
			// ... existing diff logic ...
			console.log('PusherPersistence: Received incremental sync')
			isUpdatingFromRemote.current = true
			try {
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
			} catch (err) {
				console.error('PusherPersistence: Remote merge error:', err)
			}
			isUpdatingFromRemote.current = false
		})

		channel.bind('drawing-sync-request', () => {
			console.log('PusherPersistence: Received full sync request (payload too large fallback)')
			loadInitial()
		})

		return () => {
			console.log('PusherPersistence: Cleaning up subscription...')
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
			console.log('PusherPersistence: Attempting to save to MongoDB...')
			try {
				const res = await fetch('/api/drawing', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ id: DRAWING_ID, snapshot }),
				})
				if (!res.ok) {
					const errorData = await res.json().catch(() => ({}))
					console.error('PusherPersistence: Save Failed - Status:', res.status, errorData)
				} else {
					console.log('PusherPersistence: Save Successful (Throttled)')
				}
			} catch (err) {
				console.error('PusherPersistence: Network Error during save:', err)
			}
		}, 2000)

		// Emergency save on window close
		const handleBeforeUnload = () => {
			if (isUpdatingFromRemote.current) return
			const snapshot = getSnapshot(store)
			// Using fetch with keepalive: true for beforeunload
			fetch('/api/drawing', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: DRAWING_ID, snapshot }),
				keepalive: true
			})
		}
		window.addEventListener('beforeunload', handleBeforeUnload)

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
				// Accumulate only relevant changes (shapes, assets, pages, document)
				for (const [id, record] of Object.entries(update.changes.added)) {
					const type = (record as any).typeName
					if (type === 'shape' || type === 'asset' || type === 'page' || type === 'document') {
						pendingChanges.added[id] = record
					}
				}
				for (const [id, record] of Object.entries(update.changes.updated)) {
					const newVal = record[1]
					const type = (newVal as any).typeName
					if (type === 'shape' || type === 'asset' || type === 'page' || type === 'document') {
						pendingChanges.updated[id] = record
					}
				}
				for (const [id, record] of Object.entries(update.changes.removed)) {
					const type = (record as any).typeName
					if (type === 'shape' || type === 'asset' || type === 'page' || type === 'document') {
						pendingChanges.removed[id] = record
					}
				}

				flushBroadcast()
				saveToDb()
			}
		}, { scope: 'document' })

		return () => {
			unsubscribe()
			window.removeEventListener('beforeunload', handleBeforeUnload)
		}
	}, [store, loadingState.status])

	return { store, loadingState }
}
