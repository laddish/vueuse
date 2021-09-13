import { watch, ref, reactive, Ref, unref, nextTick } from 'vue-demi'
import { useEventListener, useResizeObserver, createEventHook, Fn, tryOnScopeDispose } from '@vueuse/core'
import { MaybeElementRef } from '../unrefElement'
import { ConfigurableWindow, defaultWindow } from '../_configurable'

type Edges = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'left' | 'right' | 'top' | 'bottom'

export interface UseResizeOptions extends ConfigurableWindow {
  disabled?: boolean
  disableResize?: boolean | Ref<boolean>
  disableCursor?: boolean | Ref<boolean>
  xMultiplier?: number | Ref<number>
  yMultiplier?: number | Ref<number>
  borderRadius?: number | Ref<number>
  minWidth?: number | Ref<number> | 'initial'
  maxWidth?: number | Ref<number> | 'initial'
  minHeight?: number | Ref<number> | 'initial'
  maxHeight?: number | Ref<number> | 'initial'
  edges?: Edges[] | Ref<Edges[]>
}

export function useResize(target: MaybeElementRef, options: UseResizeOptions = {}) {
  const {
    window = defaultWindow,
    disabled = false,
    disableResize = false,
    disableCursor = false,
    xMultiplier = 1,
    yMultiplier = 1,
    borderRadius = 0,
    edges = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'left', 'right', 'top', 'bottom'],
  } = options
  let {
    minWidth = 0,
    maxWidth = Infinity,
    minHeight = 0,
    maxHeight = Infinity,
  } = options

  const isActive = ref(disabled)

  let width = 0
  let height = 0

  const onResizeStart = createEventHook<{ pointer: PointerEvent }>()
  const onResizeEnd = createEventHook<{ pointer: PointerEvent }>()
  const onResizeMove = createEventHook<{
    pointer: PointerEvent
    xDiff: number
    yDiff: number
    startX: number
    startY: number
    newWidth: number
    newHeight: number
    setSize: typeof setSize
  }>()

  let cleanup: Fn[] = []

  const isOverEdge = ref(false)
  const isResizing = ref(false)
  const direction = ref('')

  const pointer = reactive({ startX: 0, startY: 0, currentX: 0, currentY: 0 })

  const widthRef = ref(0)
  const heightRef = ref(0)

  const start = () => {
    cleanup.push(
      useEventListener(window, 'pointerdown', onPointerDown),
      useEventListener(window, 'pointerup', onPointerUp),
      useEventListener(window, 'pointercancel', onPointerUp),
      useEventListener(window, 'lostpointercapture', onPointerUp),
      useEventListener(window, 'pointermove', onPointerMove),
      watch(pointer, handlePointer),
      useElementSize(),
    )
    isActive.value = true
  }

  const stop = () => {
    cleanup.forEach(fn => fn())
    cleanup = []
    isActive.value = false
  }

  watch(target, (value) => {
    if (value) {
      start()
      ;({ width, height } = value.getBoundingClientRect())
      if (minWidth === 'initial') minWidth = width
      if (minHeight === 'initial') minHeight = height
      if (maxWidth === 'initial') maxWidth = width
      if (maxHeight === 'initial') maxHeight = height
    }
    else {
      stop()
    }
  })

  const setCursorAndDirection = (setCursor = '', setDirection = '', setTouchAction = 'none') => {
    direction.value = setDirection
    isOverEdge.value = !!setDirection
    !disableCursor && window!.document.body.style.setProperty('cursor', setCursor)
    window!.document.body.style.setProperty('touch-action', setTouchAction)
    window!.document.body.style.setProperty('user-select', setTouchAction)
  }

  function onPointerUp(evt: PointerEvent) {
    if (!isOverEdge.value)
      return

    isResizing.value = false
    if (evt.pointerType === 'touch')
      setCursorAndDirection('', '', '')

    onResizeEnd.trigger({ pointer: evt })
    evt.preventDefault()
  }

  async function onPointerMove(evt: PointerEvent) {
    pointer.currentX = evt.x
    pointer.currentY = evt.y

    if (!isOverEdge.value || !isResizing.value)
      return

    let newWidth = width
    let newHeight = height
    const xDiff = Math.abs(evt.x - pointer.startX) * unref(xMultiplier)
    const yDiff = Math.abs(evt.y - pointer.startY) * unref(yMultiplier)

    if (direction.value.includes('bottom'))
      newHeight += (evt.y > pointer.startY ? yDiff : -yDiff)

    if (direction.value.includes('top'))
      newHeight += (evt.y > pointer.startY ? -yDiff : yDiff)

    if (direction.value.includes('left'))
      newWidth += (evt.x > pointer.startX ? -xDiff : xDiff)

    if (direction.value.includes('right'))
      newWidth += (evt.x > pointer.startX ? xDiff : -xDiff)

    onResizeMove.trigger({
      pointer: evt,
      xDiff,
      yDiff,
      startX: pointer.startX,
      startY: pointer.startY,
      newWidth: clamp(newWidth, unref(minWidth as number), unref(maxWidth as number)),
      newHeight: clamp(newHeight, unref(minHeight as number), unref(maxHeight as number)),
      setSize,
    })

    if (!unref(disableResize))
      setSize(newWidth, newHeight)

    evt.preventDefault()
  }

  async function onPointerDown(evt: PointerEvent) {
    if (evt.pointerType === 'touch') {
      pointer.currentX = evt.x
      pointer.currentY = evt.y
      await nextTick()
    }
    if (isOverEdge.value || (isOverEdge.value && evt.pointerType === 'touch')) {
      ({ width, height } = target.value.getBoundingClientRect())
      isResizing.value = true
      pointer.startY = evt.y
      pointer.startX = evt.x
      onResizeStart.trigger({ pointer: evt })
      evt.preventDefault()
    }
  }

  const isOnForeground = (x: number, y: number) => {
    return window!.document.elementFromPoint(x, y) === target.value
  }
  const isEdgeActive = (edge: Edges) => {
    return unref(edges).includes(edge)
  }

  function handlePointer({ currentX, currentY }: typeof pointer) {
    if (isResizing.value)
      return

    let { left, right, top, bottom } = target.value.getBoundingClientRect()

    left += 1
    right -= 1
    top += 1
    bottom -= 1

    const radius = unref(borderRadius) / 2

    if (
      ((currentY - top + radius) < 8 || (currentX - left + radius) < 8)
      && Math.abs(currentY - top) < 8 && Math.abs(currentX - left) < 8
      && isEdgeActive('top-left')
      && isOnForeground(left + radius, top + radius)
    )
      setCursorAndDirection('nwse-resize', 'top-left')

    else if (
      ((currentY - top + radius) < 8 || (currentX - right - radius) < 8)
      && Math.abs(currentY - top) < 8
      && Math.abs(currentX - right) < 8
      && isEdgeActive('top-right')
      && isOnForeground(right - radius, top + radius)
    )
      setCursorAndDirection('nesw-resize', 'top-right')

    else if (
      ((currentY - bottom - radius) < 8 || (currentX - left + radius) < 8)
      && Math.abs(currentY - bottom) < 8
      && Math.abs(currentX - left) < 8
      && isEdgeActive('bottom-left')
      && isOnForeground(left + radius, bottom - radius)
    )
      setCursorAndDirection('nesw-resize', 'bottom-left')

    else if (
      ((currentY - bottom - radius) < 8 || (currentX - right - radius) < 8)
      && Math.abs(currentY - bottom) < 8
      && Math.abs(currentX - right) < 8
      && isEdgeActive('bottom-right')
      && isOnForeground(right - radius, bottom - radius)
    )
      setCursorAndDirection('nwse-resize', 'bottom-right')

    else if (
      (currentY - bottom) < 8
      && (currentY - bottom) >= 0
      && currentX > left
      && currentX < right
      && isEdgeActive('bottom')
      && isOnForeground(currentX, bottom)
    )
      setCursorAndDirection('ns-resize', 'bottom')

    else if (
      (currentY - top) > -8
      && (currentY - top) <= 0
      && currentX > left
      && currentX < right
      && isEdgeActive('top')
      && isOnForeground(currentX, top)
    )
      setCursorAndDirection('ns-resize', 'top')

    else if (
      (currentX - left) > -8
      && (currentX - left) <= 0
      && currentY > top
      && currentY < bottom
      && isEdgeActive('left')
      && isOnForeground(left, currentY)
    )
      setCursorAndDirection('ew-resize', 'left')

    else if (
      (currentX - right) < 8
      && (currentX - right) >= 0
      && currentY > top
      && currentY < bottom
      && isEdgeActive('right')
      && isOnForeground(right, currentY)
    )
      setCursorAndDirection('ew-resize', 'right')

    else
      setCursorAndDirection('', '', '')
  }

  function setSize(width: number, height: number) {
    target.value.style.width = `${clamp(width, unref(minWidth) as number, unref(maxWidth) as number)}px`
    target.value.style.height = `${clamp(height, unref(minHeight) as number, unref(maxHeight) as number)}px`
  }

  function useElementSize() {
    let warned = false
    const { stop } = useResizeObserver(target, ([entry]) => {
      widthRef.value = target.value.getBoundingClientRect().width
      heightRef.value = target.value.getBoundingClientRect().height

      if (!warned && (entry.contentRect.width === widthRef.value || entry.contentRect.height === heightRef.value)) {
        warned = true
        console.warn('To make useResize function properly, target element must have at least 1px width padding or border.')
      }
    })
    return stop
  }

  tryOnScopeDispose(stop)

  return {
    width: widthRef,
    height: heightRef,
    stop,
    start,
    direction,
    isActive,
    isOverEdge,
    isResizing,
    onResizeStart: onResizeStart.on,
    onResizeMove: onResizeMove.on,
    onResizeEnd: onResizeEnd.on,
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}