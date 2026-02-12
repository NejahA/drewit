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
			try {
				const { data, error } = await supabase
					.from('drawings')
					.select('snapshot')
					.eq('id', DRAWING_ID)
					.maybeSingle()

				if (error) throw error

				if (data?.snapshot) {
					store.loadSnapshot(data.snapshot)
				}
				
				if (!isCancelled) setLoadingState({ status: 'ready' })
			} catch (err: any) {
				console.error('Error loading snapshot:', err)
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
				console.error('Error saving snapshot:', err)
			}
		}, 2000)

		const unsubscribe = store.listen(saveSnapshot, { source: 'user', scope: 'document' })

		return () => {
			unsubscribe()
		}
	}, [store, loadingState.status])

	return { store, loadingState }
}
