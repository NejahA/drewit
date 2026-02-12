import { createTLStore, defaultShapeUtils, getSnapshot, throttle } from 'tldraw'
import { useEffect, useState, useRef } from 'react'
import Pusher from 'pusher-js'

const PUSHER_KEY = import.meta.env.VITE_PUSHER_KEY
const PUSHER_CLUSTER = import.meta.env.VITE_PUSHER_CLUSTER
const DRAWING_ID = 'global-canvas'

// Helper to filter out instance-specific records (camera, selection, etc.)
function filterSnapshot(snapshot: any) {
	if (!snapshot || !snapshot.store) return snapshot
	
	const filteredStore: Record<string, any> = {}
	for (const [id, record] of Object.entries(snapshot.store)) {
		const type = (record as any).typeName
		// Keep shapes, assets, and document globals
		// Exclude everything that is instance-specific (camera, pointer, selection, etc.)
		if (
			type === 'shape' || 
			type === 'asset' || 
			type === 'document' || 
			type === 'page'
		) {
			filteredStore[id] = record
		}
	}
	
	return {
		...snapshot,
		store: filteredStore
	}
}

export function usePusherPersistence() {
	const [store] = useState(() => createTLStore({ shapeUtils: defaultShapeUtils }))
	const [loadingState, setLoadingState] = useState<{ status: 'loading' | 'ready' | 'error'; error?: string }>({
		status: 'loading',
	})
	const pusherRef = useRef<Pusher | null>(null)
	const isUpdatingFromRemote = useRef(false)
	const lastUpdateTimestamp = useRef(0)

	useEffect(() => {
		// 1. Initial Load from DB
		async function loadInitial() {
			try {
				const response = await fetch(`/api/drawing?id=${DRAWING_ID}`)
				if (response.ok) {
					const rawSnapshot = await response.json()
					if (rawSnapshot) {
						// Filter initial load too so we don't start at some weird camera pos
						const snapshot = filterSnapshot(rawSnapshot)
						isUpdatingFromRemote.current = true
						store.loadSnapshot(snapshot)
						isUpdatingFromRemote.current = false
						lastUpdateTimestamp.current = Date.now()
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
		
		channel.bind('drawing-update', (data: { snapshot: any; timestamp: number }) => {
			const { snapshot: rawSnapshot, timestamp: remoteTimestamp } = data
			
			if (rawSnapshot && remoteTimestamp > lastUpdateTimestamp.current) {
				// Filter incoming snapshot to preserve local camera
				const newSnapshot = filterSnapshot(rawSnapshot)
				const current = filterSnapshot(getSnapshot(store))
				
				// Deep string comparison (simple but works for shapes)
				if (JSON.stringify(newSnapshot.store) !== JSON.stringify(current.store)) {
					console.log('PusherPersistence: Syncing remote update (Newer TS, Filtered)')
					isUpdatingFromRemote.current = true
					store.loadSnapshot(newSnapshot)
					isUpdatingFromRemote.current = false
					lastUpdateTimestamp.current = remoteTimestamp
				}
			}
		})

		return () => {
			pusher.unsubscribe(`drawing-${DRAWING_ID}`)
			pusher.disconnect()
		}
	}, [store])

	useEffect(() => {
		if (loadingState.status !== 'ready') return

		const sendUpdate = throttle(async () => {
			if (isUpdatingFromRemote.current) return
			
			const socketId = pusherRef.current?.connection.socket_id
			// Filter outgoing snapshot to reduce payload and prevent syncing camera
			const snapshot = filterSnapshot(getSnapshot(store))
			const timestamp = Date.now()
			lastUpdateTimestamp.current = timestamp
			
			console.log('PusherPersistence: Sending update...', socketId ? `(Excl: ${socketId})` : '')
			
			try {
				await fetch('/api/pusher-trigger', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ 
						id: DRAWING_ID, 
						snapshot,
						socketId: socketId,
						timestamp: timestamp
					}),
				})
			} catch (err) {
				console.error('PusherPersistence: Sync error:', err)
			}
		}, 150)

		const unsubscribe = store.listen((update) => {
			if (update.source === 'user') {
				sendUpdate()
			}
		}, { scope: 'document' })

		return () => {
			unsubscribe()
		}
	}, [store, loadingState.status])

	return { store, loadingState }
}
