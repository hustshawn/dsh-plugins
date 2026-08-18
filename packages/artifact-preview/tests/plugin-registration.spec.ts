/**
 * Slot registration: what `apply()` contributes, and the rules the slot registry
 * enforces at load time.
 *
 * This is the regression suite for a real boot failure. `shell.overlay` is a
 * LIST slot, and ui-slots rejects a list registration without `options.id` while
 * applying the plugin — which fails the whole client tree, so the GUI showed
 * "Failed to load plugins" instead of starting. The fake registry below applies
 * the same rules, so an omission fails here rather than at a user's boot.
 */
import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { ARTIFACT_KIND } from '../src/client/artifact-definition.ts'

/** Slot kinds as the shipped Web composition declares them. */
const SLOT_KINDS: Record<string, 'keyed' | 'list' | 'single' | 'chain'> = {
  'conversation.chat.node': 'keyed',
  'shell.overlay': 'list',
}

/** One captured registration. */
interface Registration {
  name: string
  key?: string
  id?: string
  order?: number
  locale?: string
  component: unknown
}

/**
 * A slot registry applying ui-slots' load-time rules.
 * @returns The fake context plus what it captured.
 */
function fakeContext() {
  const registrations: Registration[] = []
  const definitions: string[] = []
  const declaredSlots = new Set(Object.keys(SLOT_KINDS))

  const ctx = {
    conversationEvents: {
      register: (definition: { kind?: string }) => {
        if (definition.kind === undefined) throw new Error('definition requires a kind')
        definitions.push(definition.kind)
        return () => {}
      },
    },
    slots: {
      inject: (name: string, contribute: () => unknown) => {
        // A bare register into an undeclared slot is an error; inject waits for
        // the declaration, so an unknown name is a composition mistake.
        if (!declaredSlots.has(name)) throw new Error(`slot "${name}" is not declared`)
        return contribute()
      },
      register: (options: Registration, component: unknown) => {
        const kind = SLOT_KINDS[options.name]
        if (kind === undefined) throw new Error(`slot "${options.name}" is not declared`)
        if (kind === 'keyed' && options.key === undefined) {
          throw new Error(`keyed slot "${options.name}" requires options.key`)
        }
        if (kind === 'list' && options.id === undefined) {
          throw new Error(`list slot "${options.name}" requires options.id`)
        }
        const clash = registrations.find(r =>
          r.name === options.name
          && (kind === 'keyed' ? r.key === options.key : r.id === options.id))
        if (clash !== undefined) {
          throw new Error(`slot "${options.name}" already has this entry`)
        }
        registrations.push({ ...options, component })
        return () => {}
      },
    },
  }
  return { ctx, registrations, definitions }
}

describe('plugin injection', () => {
  it('declares exactly the services apply() uses', () => {
    expect(inject).toEqual(['conversationEvents', 'slots'])
  })
})

describe('apply', () => {
  it('completes without throwing under the registry rules', () => {
    // The boot failure this suite exists for showed up exactly here.
    const { ctx } = fakeContext()
    expect(() => { apply(ctx as never) }).not.toThrow()
  })

  it('registers the artifact Definition', () => {
    const { ctx, definitions } = fakeContext()
    apply(ctx as never)
    expect(definitions).toEqual([ARTIFACT_KIND])
  })

  it('contributes exactly two slot entries', () => {
    const { ctx, registrations } = fakeContext()
    apply(ctx as never)
    expect(registrations.map(r => r.name)).toEqual([
      'conversation.chat.node',
      'shell.overlay',
    ])
  })

  it('gives the keyed Chat entry a key and a locale namespace', () => {
    const { ctx, registrations } = fakeContext()
    apply(ctx as never)
    const chat = registrations.find(r => r.name === 'conversation.chat.node')
    expect(chat).toMatchObject({ key: ARTIFACT_KIND, locale: 'conversation' })
  })

  it('gives the list overlay entry an id', () => {
    // The missing field that failed the whole client tree at boot.
    const { ctx, registrations } = fakeContext()
    apply(ctx as never)
    const overlay = registrations.find(r => r.name === 'shell.overlay')
    expect(overlay?.id).toBe(ARTIFACT_KIND)
  })

  it('gives the overlay entry an explicit order', () => {
    const { ctx, registrations } = fakeContext()
    apply(ctx as never)
    expect(registrations.find(r => r.name === 'shell.overlay')?.order).toBe(50)
  })

  it('registers a component for each entry', () => {
    const { ctx, registrations } = fakeContext()
    apply(ctx as never)
    for (const registration of registrations) {
      expect(typeof registration.component).toBe('function')
    }
  })

  it('reaches both slots through inject rather than bare register', () => {
    // Apply order is unconstrained, so a contribution must wait on the
    // declaration instead of assuming the owning plugin already applied.
    const { ctx } = fakeContext()
    const injectSpy = vi.spyOn(ctx.slots, 'inject')
    apply(ctx as never)
    expect(injectSpy.mock.calls.map(call => call[0])).toEqual([
      'conversation.chat.node',
      'shell.overlay',
    ])
  })
})

describe('the registry fake itself', () => {
  // A guard that never fires is worthless, so the rules are checked directly.
  it('rejects a list registration with no id', () => {
    const { ctx } = fakeContext()
    expect(() => ctx.slots.register({ name: 'shell.overlay' } as never, () => null))
      .toThrow('list slot "shell.overlay" requires options.id')
  })

  it('rejects a keyed registration with no key', () => {
    const { ctx } = fakeContext()
    expect(() => ctx.slots.register({ name: 'conversation.chat.node' } as never, () => null))
      .toThrow('keyed slot "conversation.chat.node" requires options.key')
  })

  it('rejects an undeclared slot name', () => {
    const { ctx } = fakeContext()
    expect(() => ctx.slots.inject('shell.nope', () => null))
      .toThrow('slot "shell.nope" is not declared')
  })

  it('rejects a duplicate entry', () => {
    const { ctx } = fakeContext()
    apply(ctx as never)
    expect(() => { apply(ctx as never) }).toThrow(/already has this entry/)
  })
})
