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

		const saveSnapshot = throttle(async () => {
			const snapshot = store.getSnapshot()
			console.log('useSupabasePersistence: Saving snapshot...')
			try {
				const { error } = await supabase
					.from('drawings')
					.upsert({
						id: DRAWING_ID,
						snapshot,
						updated_at: new Date().toISOString(),
					})
				if (error) {
					console.error('useSupabasePersistence: Supabase error saving snapshot:', error)
					throw error
				}
				console.log('useSupabasePersistence: Snapshot saved.')
			} catch (err) {
				console.error('useSupabasePersistence: Error saving snapshot:', err)
			}
		}, 2000)

		// We only want to save changes made by the USER in this session
		const unsubscribe = store.listen(saveSnapshot, { source: 'user', scope: 'document' })

		return () => {
			unsubscribe()
		}
	}, [store, loadingState.status])

	useEffect(() => {
		if (loadingState.status !== 'ready') return

		console.log('useSupabasePersistence: Subscribing to realtime changes...')
		const channel = supabase
			.channel(`drawing:${DRAWING_ID}`)
			.on(
				'postgres_changes',
				{
					event: 'UPDATE',
					schema: 'public',
					table: 'drawings',
					filter: `id=eq.${DRAWING_ID}`,
				},
				(payload) => {
					console.log('useSupabasePersistence: Received realtime update')
					const newSnapshot = payload.new.snapshot
					if (newSnapshot) {
						// Don't reload if we are already in sync
						const current = store.getSnapshot()
						if (JSON.stringify(newSnapshot) !== JSON.stringify(current)) {
							console.log('useSupabasePersistence: Syncing remote changes...')
							store.loadSnapshot(newSnapshot)
						}
					}
				}
			)
			.subscribe((status) => {
				console.log('useSupabasePersistence: Realtime subscription status:', status)
			})

		return () => {
			console.log('useSupabasePersistence: Unsubscribing from realtime.')
			supabase.removeChannel(channel)
		}
	}, [store, loadingState.status])

	return { store, loadingState }
}
