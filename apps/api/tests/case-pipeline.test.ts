import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { notifySweep } from '../src/jobs/notify-sweep.js'
import { A1, A2, boot, uid, type Harness } from './helpers.js'

/** Opening a case and moving it through the desk: who can hold it, who can hand it on, who is told, and what is recorded. */
const A3 = uid('agent3')
const SUP = uid('sup1')
const ADM = uid('admin1')
const newCase = (over: Record<string, unknown> = {}) => ({ category: 'wallet_debited_no_token', customerRef: 'c1', customerPhone: '0803 555 0142', amountNgn: 5000, ...over })

let h: Harness
type Who = { cookie: string; headers: Record<string, string> }
let a1: Who, a2: Who, a3: Who, sup: Who, adm: Who

/** Everyone signs in and shows up on the roster (that is how Beverly Call learns who can hold cases in API mode). */
async function signInEveryone(): Promise<void> {
  a1 = await h.as('agent1@x.test'); a2 = await h.as('agent2@x.test'); a3 = await h.as('agent3@x.test'); sup = await h.as('sup1@x.test'); adm = await h.as('admin1@x.test')
  for (const w of [a1, a2, a3, sup, adm]) await h.send('PUT', '/api/presence', w, { status: 'available', languages: ['en'] })
}
const open = async (who: Who, over: Record<string, unknown> = {}) => (await h.send('POST', '/api/cases', who, newCase(over))).json
const notes = async (user: string) => (await h.pool.query<{ title: string; link: string; category: string }>('select title, link, category from call_centre.notifications where user_crm_id = $1 order by created_at', [user])).rows
const titles = async (user: string) => (await notes(user)).map((n) => n.title)
const audit = async (action: string) => (await h.pool.query<{ details: Record<string, unknown> | null }>('select metadata as details from call_centre.audit_log where action = $1', [action])).rows

beforeAll(async () => { h = await boot() })
beforeEach(async () => { await h.reset(); await signInEveryone() })
afterAll(async () => { await h.app.close() })

describe('opening a case', () => {
  it('goes to the person opening it by default, and is already being worked', async () => {
    const c = await open(a1)
    expect(c).toMatchObject({ agentId: A1, raisedById: A1, state: 'Working', accepted: true })
    expect(c.events.map((e: { text: string }) => e.text)).toEqual(['Opened and taken by agent1'])
  })

  it('can go straight to another agent or a supervisor, who is told and must start it', async () => {
    const c = await open(a1, { assigneeId: A2 })
    expect(c).toMatchObject({ agentId: A2, raisedById: A1, state: 'New', accepted: false })
    expect(c.events[0].text).toBe('Opened by agent1 and given to agent2')
    expect(await notes(A2)).toEqual([expect.objectContaining({ title: 'EX-2042 assigned to you', link: '/cases?open=EX-2042', category: 'esc' })])
    expect(await titles(A1)).toEqual([])   // the person who gave it away is not told about their own action
    const s = await open(a1, { assigneeId: SUP })
    expect(s).toMatchObject({ agentId: SUP, state: 'New' })
  })

  it('can go into the queue, where the supervisors and admins are told and agents are not', async () => {
    const c = await open(a1, { assigneeId: null })
    expect(c).toMatchObject({ agentId: null, by: 'Unassigned', state: 'New', raisedById: A1 })
    expect(c.events[0].text).toBe('Opened by agent1 and put in the queue')
    expect(await titles(SUP)).toEqual(['EX-2042 is waiting in the queue'])
    expect(await titles(ADM)).toEqual(['EX-2042 is waiting in the queue'])
    expect(await titles(A2)).toEqual([])
    expect(await titles(A1)).toEqual([])
    expect((await h.get('/api/cases/queue', a2)).json.map((x: { id: string }) => x.id)).toEqual(['EX-2042'])
  })

  it('an admin opening a case cannot keep it (admins do not hold cases): it goes to the queue', async () => {
    const c = await open(adm)
    expect(c).toMatchObject({ agentId: null, raisedById: ADM })
    expect((await h.send('POST', '/api/cases', adm, newCase({ assigneeId: ADM }))).status).toBe(400)
  })

  it('refuses an assignee who cannot hold cases instead of guessing', async () => {
    for (const bad of [ADM, uid('stranger'), 'not-a-person']) {
      const r = await h.send('POST', '/api/cases', a1, newCase({ assigneeId: bad }))
      expect(r.status, bad).toBe(400)
      expect(r.json.error).toMatch(/cannot hold cases/)
    }
    expect((await h.pool.query('select 1 from call_centre.tickets')).rowCount).toBe(0)
  })

  it('tells the supervisors about a case an agent keeps, but not the agent who opened it', async () => {
    await open(a1)
    expect(await titles(SUP)).toEqual(['EX-2042 escalated'])
    expect(await titles(A1)).toEqual([])
  })
})

describe('who a case can be given to', () => {
  it('lists agents and supervisors with presence and workload, never admins, available people first', async () => {
    await h.send('PUT', '/api/presence', a2, { status: 'break', languages: ['en'] })
    await open(a1)                      // agent1 now holds one
    await h.pool.query(`update call_centre.agent_presence set last_seen = now() - interval '5 minutes' where agent_crm_id = $1`, [A3])   // agent3 went quiet
    const list = (await h.get('/api/cases/assignees', a1)).json as { id: string; role: string; presence: string; openCases: number }[]
    expect(list.map((p) => p.id)).not.toContain(ADM)
    expect(new Set(list.map((p) => p.id))).toEqual(new Set([A1, A2, A3, SUP]))
    const byId = Object.fromEntries(list.map((p) => [p.id, p]))
    expect(byId[A2]).toMatchObject({ presence: 'break', role: 'agent' })
    expect(byId[A3]!.presence).toBe('offline')
    expect(byId[A1]!.openCases).toBe(1)
    expect(list[0]!.presence).toBe('available')
    expect(list.at(-1)!.presence).toBe('offline')
  })
})

describe('handing a case on', () => {
  it('a supervisor can move it, and everyone involved hears what happened', async () => {
    await open(a1)                                                       // held by agent1
    const r = await h.send('POST', '/api/cases/EX-2042/assign', sup, { agentId: A2, note: 'You know this vendor' })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ agentId: A2, state: 'New', accepted: false, raisedById: A1 })
    expect(r.json.events.at(-1).text).toBe('sup1 moved it from Aisha Bello to agent2 (You know this vendor)')   // names come from Beverly's directory when it knows them
    expect(await titles(A2)).toEqual(['EX-2042 assigned to you'])         // the new holder
    expect(await titles(A1)).toEqual(['EX-2042 was moved to agent2'])      // the old holder (who is also the one who raised it)
    expect((await audit('case.assign'))[0]!.details).toMatchObject({ from: A1, to: A2, note: 'You know this vendor' })
  })

  it('tells the person who raised it when it moves between two other people', async () => {
    const c = await open(a1, { assigneeId: A2 })
    await h.send('POST', `/api/cases/${c.id}/assign`, sup, { agentId: A3 })
    expect(await titles(A1)).toEqual(['EX-2042 is now with agent3'])       // raised it, not involved in the move
    expect(await titles(A2)).toEqual(['EX-2042 assigned to you', 'EX-2042 was moved to agent3'])
    expect(await titles(A3)).toEqual(['EX-2042 assigned to you'])
  })

  it('the person holding a case can hand it on, but another agent cannot take it from them', async () => {
    await open(a1)
    expect((await h.send('POST', '/api/cases/EX-2042/assign', a2, { agentId: A2 })).status).toBe(403)
    expect((await h.send('POST', '/api/cases/EX-2042/assign', a1, { agentId: A2, note: 'Shift ending' })).status).toBe(200)
    expect((await h.send('POST', '/api/cases/EX-2042/assign', a1, { agentId: A3 })).status).toBe(403)   // no longer theirs
  })

  it('refuses to hand a case to someone who cannot hold it, to the person who already holds it, or when it is closed', async () => {
    await open(a1)
    expect((await h.send('POST', '/api/cases/EX-2042/assign', sup, { agentId: ADM })).status).toBe(400)
    expect((await h.send('POST', '/api/cases/EX-2042/assign', sup, { agentId: uid('stranger') })).status).toBe(400)
    const same = await h.send('POST', '/api/cases/EX-2042/assign', sup, { agentId: A1 })
    expect(same.status).toBe(409)
    expect(same.json.error).toMatch(/already holds/)
    await h.send('POST', '/api/cases/EX-2042/resolve', sup, { note: 'Fixed' })
    expect((await h.send('POST', '/api/cases/EX-2042/assign', sup, { agentId: A2 })).status).toBe(404)
    expect((await h.send('POST', '/api/cases/EX-9999/assign', sup, { agentId: A2 })).status).toBe(404)
    expect((await h.send('POST', '/api/cases/EX-2042/assign', sup, {})).status).toBe(400)
  })

  it('a case given to a person from the queue is held by them but only counts as started once they accept', async () => {
    await open(a1, { assigneeId: null })
    const r = await h.send('POST', '/api/cases/EX-2042/assign', sup, { agentId: A2 })
    expect(r.json).toMatchObject({ agentId: A2, accepted: false, state: 'New' })
    expect(r.json.events.at(-1).text).toBe('sup1 gave it to agent2')
  })
})

describe('taking a case from the queue', () => {
  it('the first to take it gets it and starts it; the next is told someone was quicker', async () => {
    await open(a1, { assigneeId: null })
    const first = await h.send('POST', '/api/cases/EX-2042/claim', a2)
    expect(first.status).toBe(200)
    expect(first.json).toMatchObject({ agentId: A2, state: 'Working', accepted: true })
    expect(first.json.events.at(-1).text).toBe('agent2 took it from the queue and started')
    const second = await h.send('POST', '/api/cases/EX-2042/claim', a3)
    expect(second.status).toBe(409)
    expect(second.json.error).toBe('Someone already took this case')
    expect((await h.get('/api/cases/queue', a3)).json).toEqual([])
    expect(await titles(A1)).toEqual(['agent2 took EX-2042'])              // whoever raised it
  })

  it('two people taking it at the same moment cannot both get it', async () => {
    await open(a1, { assigneeId: null })
    const results = await Promise.all([h.send('POST', '/api/cases/EX-2042/claim', a2), h.send('POST', '/api/cases/EX-2042/claim', a3), h.send('POST', '/api/cases/EX-2042/claim', sup)])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409])
    expect((await h.pool.query('select agent_crm_id from call_centre.tickets')).rows).toHaveLength(1)
    expect((await h.pool.query(`select 1 from call_centre.ticket_events where kind = 'claimed'`)).rowCount).toBe(1)
  })

  it('admins cannot take cases, and a closed or missing case cannot be taken', async () => {
    await open(a1, { assigneeId: null })
    expect((await h.send('POST', '/api/cases/EX-2042/claim', adm)).status).toBe(403)
    await h.send('POST', '/api/cases/EX-2042/claim', a2)
    await h.send('POST', '/api/cases/EX-2042/resolve', a2, { note: 'Done' })
    expect((await h.send('POST', '/api/cases/EX-2042/claim', a3)).json.error).toBe('This case is already closed')
    expect((await h.send('POST', '/api/cases/EX-9999/claim', a3)).status).toBe(404)
  })
})

describe('starting a case that was given to you', () => {
  it('only the holder can start it; the person who gave it and the person who raised it are told', async () => {
    await open(a1, { assigneeId: A2 })
    await h.send('POST', '/api/cases/EX-2042/assign', sup, { agentId: A3 })
    expect((await h.send('POST', '/api/cases/EX-2042/accept', a2)).status).toBe(403)   // no longer theirs
    const r = await h.send('POST', '/api/cases/EX-2042/accept', a3)
    expect(r.json).toMatchObject({ state: 'Working', accepted: true })
    expect(r.json.events.at(-1).text).toBe('agent3 started working on it')
    expect(await titles(A1)).toContain('agent3 started EX-2042')
    expect(await titles(SUP)).toContain('agent3 started EX-2042')
  })

  it('starting twice changes nothing and does not tell anyone twice', async () => {
    await open(a1, { assigneeId: A2 })
    await h.send('POST', '/api/cases/EX-2042/accept', a2)
    const again = await h.send('POST', '/api/cases/EX-2042/accept', a2)
    expect(again.status).toBe(200)
    expect(again.json.events.filter((e: { text: string }) => /started/.test(e.text))).toHaveLength(1)
    expect((await titles(A1)).filter((t) => /started/.test(t))).toHaveLength(1)
  })

  it('a case in the queue cannot be started by someone who does not hold it', async () => {
    await open(a1, { assigneeId: null })
    expect((await h.send('POST', '/api/cases/EX-2042/accept', a2)).status).toBe(403)
    expect((await h.send('POST', '/api/cases/EX-9999/accept', a2)).status).toBe(404)
  })
})

describe('putting a case back in the queue', () => {
  it('the holder returns it, and the supervisors are told it needs someone', async () => {
    await open(a1)
    const r = await h.send('POST', '/api/cases/EX-2042/release', a1, { note: 'Not my area' })
    expect(r.json).toMatchObject({ agentId: null, by: 'Unassigned', state: 'New', accepted: false })
    expect(r.json.events.at(-1).text).toBe('agent1 put it back in the queue (Not my area)')
    expect((await titles(SUP)).at(-1)).toBe('EX-2042 is back in the queue')
    expect((await h.get('/api/cases/queue', a2)).json).toHaveLength(1)
    expect((await audit('case.release'))[0]!.details).toMatchObject({ from: A1, note: 'Not my area' })
  })

  it('a supervisor can take a case off someone, who is told', async () => {
    await open(a1)
    await h.send('POST', '/api/cases/EX-2042/release', sup)
    expect(await titles(A1)).toContain('EX-2042 was taken off you')
  })

  it('refuses when it is already in the queue, or when an agent does not hold it', async () => {
    await open(a1, { assigneeId: null })
    expect((await h.send('POST', '/api/cases/EX-2042/release', sup)).status).toBe(409)
    await h.send('POST', '/api/cases/EX-2042/claim', a1)
    expect((await h.send('POST', '/api/cases/EX-2042/release', a2)).status).toBe(403)
  })
})

describe('working a case after it has moved', () => {
  it('both the holder and whoever raised it can comment, others cannot, and the other side is told', async () => {
    await open(a1)
    await h.send('POST', '/api/cases/EX-2042/assign', sup, { agentId: A2 })
    expect((await h.send('POST', '/api/cases/EX-2042/comments', a1, { text: 'Customer says it is urgent' })).status).toBe(200)   // raised it
    expect((await h.send('POST', '/api/cases/EX-2042/comments', a2, { text: 'On it' })).status).toBe(200)                          // holds it
    expect((await h.send('POST', '/api/cases/EX-2042/comments', a3, { text: 'Can I help?' })).status).toBe(403)
    expect((await titles(A2)).filter((t) => /commented/.test(t))).toEqual(['agent1 commented on EX-2042'])
    expect((await titles(A1)).filter((t) => /commented/.test(t))).toEqual(['agent2 commented on EX-2042'])
  })

  it('resolving tells whoever raised it, who still sees the case', async () => {
    await open(a1)
    await h.send('POST', '/api/cases/EX-2042/assign', sup, { agentId: A2 })
    await h.send('POST', '/api/cases/EX-2042/accept', a2)
    const done = await h.send('POST', '/api/cases/EX-2042/resolve', a2, { note: 'Token re-issued' })
    expect(done.json.state).toBe('Done')
    expect(await titles(A1)).toContain('EX-2042 was resolved')
    expect((await h.get('/api/cases/mine', a1)).json.map((c: { id: string; state: string }) => `${c.id}:${c.state}`)).toEqual(['EX-2042:Done'])
  })
})

describe('who sees what', () => {
  it('"mine" holds what a person holds and what they raised, even after it moved', async () => {
    await open(a1)                                                 // EX-2042, agent1 holds
    await open(a1, { assigneeId: A2 })                             // EX-2043, raised by agent1, held by agent2
    await open(a2)                                                 // EX-2044, agent2's own
    const mine1 = (await h.get('/api/cases/mine', a1)).json.map((c: { id: string }) => c.id).sort()
    const mine2 = (await h.get('/api/cases/mine', a2)).json.map((c: { id: string }) => c.id).sort()
    expect(mine1).toEqual(['EX-2042', 'EX-2043'])
    expect(mine2).toEqual(['EX-2043', 'EX-2044'])
    expect((await h.get('/api/cases/mine', a3)).json).toEqual([])
  })

  it('a single case opens for its holder, whoever raised it, anyone while it is in the queue, and any supervisor; not for other agents', async () => {
    await open(a1, { assigneeId: A2 })                             // raised by 1, held by 2
    expect((await h.get('/api/cases/EX-2042', a1)).status).toBe(200)
    expect((await h.get('/api/cases/EX-2042', a2)).status).toBe(200)
    expect((await h.get('/api/cases/EX-2042', a3)).status).toBe(403)
    expect((await h.get('/api/cases/EX-2042', sup)).status).toBe(200)
    await h.send('POST', '/api/cases/EX-2042/release', sup)
    expect((await h.get('/api/cases/EX-2042', a3)).status).toBe(200)   // waiting for someone to take it
    expect((await h.get('/api/cases/EX-9999', sup)).status).toBe(404)
  })
})

describe('alerts that reach a closed app', () => {
  it('push the assignment to the new holder\'s device with a link straight to the case', async () => {
    await h.send('POST', '/api/push/subscribe', a2, { endpoint: 'https://push.test/agent2', keys: { p256dh: 'p', auth: 'a' } })
    await open(a1, { assigneeId: A2 })
    const sent = h.fakes.pushed.map((p) => JSON.parse(p) as { title: string; link: string; category: string; urgent: boolean })
    expect(sent).toEqual([expect.objectContaining({ title: 'EX-2042 assigned to you', link: '/cases?open=EX-2042', category: 'esc', urgent: false })])
  })

  it('a muted escalation category is not pushed to a device that muted it, but is still stored in the bell', async () => {
    await h.send('POST', '/api/push/subscribe', a2, { endpoint: 'https://push.test/agent2', keys: { p256dh: 'p', auth: 'a' }, prefs: { mute: { esc: true, cb: false, sys: false }, sounds: true } })
    await open(a1, { assigneeId: A2 })
    expect(h.fakes.pushed).toEqual([])
    expect(await titles(A2)).toEqual(['EX-2042 assigned to you'])
  })
})

describe('a case nobody holds that runs out of time', () => {
  it('tells the supervisors and admins, not the whole desk, and only once', async () => {
    await h.pool.query(`insert into public.users (auth_user_id, user_name, email, role_key, portal_access) values
      ($1,'sup1','sup1@x.test','custom-call-centre-supervisor','{call}'), ($2,'admin1','admin1@x.test','super-admin','{call}'), ($3,'agent1','agent1@x.test','custom-call-centre-agent','{call}')`, [SUP, ADM, A1])
    await open(a1, { assigneeId: null })
    await h.pool.query(`update call_centre.tickets set sla_due_at = now() - interval '10 minutes'`)
    await h.pool.query('truncate call_centre.notifications restart identity cascade')   // forget the "waiting in the queue" alerts
    expect(await notifySweep(h.pool, null)).toBe(2)
    expect(await notifySweep(h.pool, null)).toBe(0)
    const rows = (await h.pool.query<{ user_crm_id: string | null; title: string }>('select user_crm_id, title from call_centre.notifications order by user_crm_id')).rows
    expect(rows.map((r) => r.user_crm_id).sort()).toEqual([ADM, SUP].sort())
    expect(rows.every((r) => /nobody holds it/.test(r.title))).toBe(true)
  })

  it('a case somebody holds still goes to them alone', async () => {
    await open(a1)
    await h.pool.query(`update call_centre.tickets set sla_due_at = now() - interval '10 minutes'`)
    await h.pool.query('truncate call_centre.notifications restart identity cascade')
    expect(await notifySweep(h.pool, null)).toBe(1)
    expect(await titles(A1)).toEqual(['EX-2042 is past its deadline'])
  })
})

describe('the record', () => {
  it('keeps every step in order, and the history cannot be edited or deleted by the app role', async () => {
    const c = await open(a1, { assigneeId: null })
    await h.send('POST', `/api/cases/${c.id}/claim`, a2)
    await h.send('POST', `/api/cases/${c.id}/release`, a2, { note: 'Too busy' })
    await h.send('POST', `/api/cases/${c.id}/assign`, sup, { agentId: A3 })
    await h.send('POST', `/api/cases/${c.id}/accept`, a3)
    const kinds = (await h.pool.query<{ kind: string }>('select kind from call_centre.ticket_events order by created_at, id')).rows.map((r) => r.kind)
    expect(kinds).toEqual(['opened', 'claimed', 'released', 'assigned', 'accepted'])
    const grants = (await h.pool.query<{ p: string }>(`select privilege_type p from information_schema.role_table_grants where table_schema = 'call_centre' and table_name = 'ticket_events' and grantee = 'beverly_call_api'`)).rows.map((r) => r.p).sort()
    expect(grants).toEqual(['INSERT', 'SELECT'])
  })

  it('existing cases are treated as raised by the person who held them (the migration backfill)', async () => {
    await h.pool.query(`insert into call_centre.tickets (ticket_ref, customer_ref, category, agent_crm_id, sla_due_at) values ('EX-0001','c9','other',$1, now() + interval '1 hour')`, [A1])
    await h.pool.query(`update call_centre.tickets set created_by_crm_id = null`)
    await h.pool.query(`update call_centre.tickets set created_by_crm_id = agent_crm_id where created_by_crm_id is null and agent_crm_id is not null`)   // the statement the migration runs
    expect((await h.get('/api/cases/mine', a1)).json[0]).toMatchObject({ id: 'EX-0001', raisedById: A1 })
  })
})
