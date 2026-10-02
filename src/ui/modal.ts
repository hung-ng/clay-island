type InertElement = Element & { inert: boolean }

function hasInert(element: Element): element is InertElement {
  return 'inert' in element && typeof element.inert === 'boolean'
}

/** Save sibling inert states when opening and restore them when closing. */
export function createModalBackground(
  host: { readonly children: Iterable<Element> },
  modal: Element,
): (inert: boolean) => void {
  const previousState = new Map<InertElement, boolean>()

  return (inert) => {
    if (inert) {
      for (const element of host.children) {
        if (element === modal || !hasInert(element)) continue
        if (!previousState.has(element)) previousState.set(element, element.inert)
        element.inert = true
      }
      return
    }

    for (const [element, wasInert] of previousState) element.inert = wasInert
    previousState.clear()
  }
}
