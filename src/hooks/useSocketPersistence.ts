import { createTLStore, defaultShapeUtils, throttle } from 'tldraw'
import { useEffect, useState, useRef } from 'react'
import { io, Socket } from 'socket.io-client'

const SERVER_URL = window.location.hostname === 'localhost' ? 'http://localhost:5000' : window.location.origin

export function useSocketPersistence() {
	const [store] = useState(() => createTLStore({ shapeUtils: defaultShapeUtils }))
	const [loadingState, setLoadingState] = useState<{ status: 'loading' | 'ready' | 'error'; error?: string }>({
		status: 'loading',
	})
	const socketRef = useRef<Socket | null>(null)
	const isUpdatingFromRemote = useRef(false)

	useEffect(() => {
		const socket = io(SERVER_URL)
		socketRef.current = socket

		socket.on('connect', () => {
			console.log('Socket: Connected to server')
		})

		socket.on('init-store', (snapshot) => {
			console.log('Socket: Receiving initial snapshot')
			isUpdatingFromRemote.current = true
			store.loadSnapshot(snapshot)
			isUpdatingFromRemote.current = false
			setLoadingState({ status: 'ready' })
		})

		socket.on('sync-store', (snapshot) => {
			console.log('Socket: Receiving remote update')
			isUpdatingFromRemote.current = true
			store.loadSnapshot(snapshot)
			isUpdatingFromRemote.current = false
		})

		socket.on('connect_error', (err) => {
			console.error('Socket: Connection error:', err)
			setLoadingState({ status: 'error', error: 'Could not connect to sync server' })
		})

		// Safety timeout for loading state
		const timeout = setTimeout(() => {
			if (loadingState.status === 'loading') {
				setLoadingState({ status: 'ready' })
			}
		}, 3000)

		return () => {
			socket.disconnect()
			clearTimeout(timeout)
		}
	}, [store])

	useEffect(() => {
		if (loadingState.status !== 'ready' || !socketRef.current) return

		const sendUpdate = throttle(() => {
			if (isUpdatingFromRemote.current) return
			console.log('Socket: Sending local update to server')
			socketRef.current?.emit('update-store', store.getSnapshot())
		}, 500)

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
