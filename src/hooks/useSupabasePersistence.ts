import { createTLStore, defaultShapeUtils, throttle } from 'tldraw'
import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

const DRAWING_ID = 'global-canvas' // We can make this dynamic later if needed

export function useSupabasePersistence() {
	const [store] = useState(() => createTLStore({ shapeUtils: defaultShapeUtils }))
	const [loadingState, setLoadingState] = useState<{ status: 'loading' | 'ready' | 'error'; error?: string }>({
		status: 'loading',
	})

	useEffect(() => {
		let isCancelled = false

		async function loadSnapshot() {
			console.log('useSupabasePersistence: Loading initial snapshot...')
			try {
				const { data, error } = await supabase
					.from('drawings')
					.select('snapshot')
					.eq('id', DRAWING_ID)
					.maybeSingle()

				if (error) {
					console.error('useSupabasePersistence: Supabase error loading snapshot:', error)
					throw error
				}

				if (data?.snapshot) {
					console.log('useSupabasePersistence: Initial snapshot loaded successfully.')
					store.loadSnapshot(data.snapshot)
				} else {
					console.log('useSupabasePersistence: No existing snapshot found for', DRAWING_ID)
				}
				
				if (!isCancelled) setLoadingState({ status: 'ready' })
			} catch (err: any) {
				console.error('useSupabasePersistence: Error loading snapshot:', err)
				if (!isCancelled) setLoadingState({ status: 'error', error: err.message })
			}
		}

		loadSnapshot()

		return () => {
			isCancelled = true
		}
	}, [store])

	useEffect(() => {
		if (loadingState.status !== 'ready') return

		const channel = supabase.channel(`canvas:${DRAWING_ID}`, {
			config: {
				broadcast: { self: false },
			},
		})

		const saveToDb = throttle(async () => {
			const snapshot = store.getSnapshot()
			console.log('useSupabasePersistence: Saving to DB...')
			try {
				const { error } = await supabase
					.from('drawings')
					.upsert({
						id: DRAWING_ID,
						snapshot,
						updated_at: new Date().toISOString(),
					})
				if (error) throw error
			} catch (err) {
				console.error('useSupabasePersistence: DB Save Error:', err)
			}
		}, 2000)

		const broadcastUpdate = throttle(() => {
			console.log('useSupabasePersistence: Broadcasting update...')
			channel.send({
				type: 'broadcast',
				event: 'canvas-update',
				payload: { snapshot: store.getSnapshot() },
			})
		}, 100) // Fast throttle for broadcast

		const unsubscribe = store.listen((update) => {
			if (update.source === 'user') {
				broadcastUpdate()
				saveToDb()
			}
		}, { scope: 'document' })

		channel
			.on('broadcast', { event: 'canvas-update' }, ({ payload }) => {
				console.log('useSupabasePersistence: Received broadcast update')
				const newSnapshot = payload.snapshot
				if (newSnapshot) {
					const current = store.getSnapshot()
					if (JSON.stringify(newSnapshot) !== JSON.stringify(current)) {
						store.loadSnapshot(newSnapshot)
					}
				}
			})
			.on(
				'postgres_changes',
				{
					event: 'UPDATE',
					schema: 'public',
					table: 'drawings',
					filter: `id=eq.${DRAWING_ID}`,
				},
				(payload) => {
					console.log('useSupabasePersistence: Received DB fallback update')
					const newSnapshot = payload.new.snapshot
					if (newSnapshot) {
						const current = store.getSnapshot()
						if (JSON.stringify(newSnapshot) !== JSON.stringify(current)) {
							store.loadSnapshot(newSnapshot)
						}
					}
				}
			)
			.subscribe((status) => {
				console.log('useSupabasePersistence: Subscription status:', status)
			})

		return () => {
			unsubscribe()
			supabase.removeChannel(channel)
		}
	}, [store, loadingState.status])

	return { store, loadingState }
}
