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

		console.log('useSupabasePersistence: Attempting to join channel:', `drawing_sync`)
		
		const channel = supabase.channel('drawing_sync', {
			config: {
				broadcast: { self: false },
				presence: { key: 'canvas' }
			}
		})

		const saveToDb = throttle(async () => {
			const snapshot = store.getSnapshot()
			try {
				const { error } = await supabase
					.from('drawings')
					.upsert({ id: DRAWING_ID, snapshot, updated_at: new Date().toISOString() })
				if (error) throw error
				console.log('useSupabasePersistence: Saved to DB')
			} catch (err) {
				console.error('useSupabasePersistence: DB Save Error:', err)
			}
		}, 2000)

		const broadcastUpdate = throttle(() => {
			channel.send({
				type: 'broadcast',
				event: 'canvas-update',
				payload: { snapshot: store.getSnapshot() },
			}).then(resp => {
				if (resp !== 'ok') console.warn('useSupabasePersistence: Broadcast send status:', resp)
			})
		}, 100)

		const unsubscribe = store.listen((update) => {
			if (update.source === 'user') {
				saveToDb()
				if (channel.state === 'joined') {
					broadcastUpdate()
				}
			}
		}, { scope: 'document' })

		channel
			.on('broadcast', { event: 'canvas-update' }, ({ payload }) => {
				const newSnapshot = payload.snapshot
				if (newSnapshot) {
					const current = store.getSnapshot()
					if (JSON.stringify(newSnapshot) !== JSON.stringify(current)) {
						console.log('useSupabasePersistence: Syncing via Broadcast')
						store.loadSnapshot(newSnapshot)
					}
				}
			})
			.on('postgres_changes', { 
				event: 'UPDATE', 
				schema: 'public', 
				table: 'drawings', 
				filter: `id=eq.${DRAWING_ID}` 
			}, (payload) => {
				const newSnapshot = payload.new.snapshot
				if (newSnapshot) {
					const current = store.getSnapshot()
					if (JSON.stringify(newSnapshot) !== JSON.stringify(current)) {
						console.log('useSupabasePersistence: Syncing via Postgres')
						store.loadSnapshot(newSnapshot)
					}
				}
			})
			.subscribe((status, err) => {
				console.log('useSupabasePersistence: Subscription Status:', status)
				if (err) console.error('useSupabasePersistence: Subscription Error:', err)
				
				if (status === 'CHANNEL_ERROR') {
					console.error('useSupabasePersistence: CHANNEL_ERROR. This usually means Realtime is disabled for this project or table.')
				}
			})

		return () => {
			unsubscribe()
			supabase.removeChannel(channel)
		}
	}, [store, loadingState.status])

	return { store, loadingState }
}
