import { createTLStore, defaultShapeUtils, throttle } from 'tldraw'
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
		// 1. Initial Load from DB (via existing API)
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
		if (!PUSHER_KEY || !PUSHER_CLUSTER) {
			console.warn('Pusher keys missing. Real-time sync disabled.')
			return
		}

		console.log('PusherPersistence: Connecting to Pusher...')
		const pusher = new Pusher(PUSHER_KEY, {
			cluster: PUSHER_CLUSTER,
		})
		pusherRef.current = pusher

		const channel = pusher.subscribe(`drawing-${DRAWING_ID}`)
		
		channel.bind('drawing-update', (data: { snapshot: any }) => {
			console.log('PusherPersistence: Received remote update')
			isUpdatingFromRemote.current = true
			store.loadSnapshot(data.snapshot)
			isUpdatingFromRemote.current = false
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
			
			const snapshot = store.getSnapshot()
			console.log('PusherPersistence: Sending update...')
			
			try {
				// We trigger a serverless function that then triggers Pusher
				await fetch('/api/pusher-trigger', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ id: DRAWING_ID, snapshot }),
				})
			} catch (err) {
				console.error('PusherPersistence: Sync error:', err)
			}
		}, 150) // Fast sync

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
