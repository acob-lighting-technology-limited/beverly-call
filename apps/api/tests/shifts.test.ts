import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { addDays, cycleWeek, isOvernight, lagosNow, mondayOf, onShiftAt, shiftFor, weekday, type RotationDef, type Shift } from '../src/shifts/engine.js'
import { agentsOnShift } from '../src/shifts/store.js'
import { A1, A2, boot, hook, PHOTO_CALLS, PHOTO_URL, uid, type Harness } from './helpers.js'

const MORNING: Shift = { id: 'm', name: 'Morning', start: '06:00', end: '14:00', color: '#E3B93C' }
const EVENING: Shift = { id: 'e', name: 'Evening', start: '14:00', end: '22:00', color: '#3C7BE3' }
const NIGHT: Shift = { id: 'n', name: 'Night', start: '22:00', end: '06:00', color: '#333333' }
const SHIFTS = new Map([MORNING, EVENING, NIGHT].map((s) => [s.id, s]))
const WEEKDAYS = [0, 1, 2, 3, 4]
// Monday 2026-11-02 starts week 1. Three-week cycle: morning, evening, night.
const ROT: RotationDef = { id: 'r', name: 'Three week', anchorDate: '2026-11-02', steps: [{ shiftId: 'm', days: WEEKDAYS }, { shiftId: 'e', days: WEEKDAYS }, { shiftId: 'n', days: WEEKDAYS }] }

describe('rotation engine', () => {
  it('knows weekdays, Mondays and overnight shifts', () => {
    expect(weekday('2026-11-16')).toBe(0); expect(weekday('2026-11-22')).toBe(6)
    expect(mondayOf('2026-11-19')).toBe('2026-11-16'); expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(isOvernight(NIGHT)).toBe(true); expect(isOvernight(MORNING)).toBe(false)
  })

  it('moves an agent through the weeks of the cycle, wrapping, and staggers by offset', () => {
    expect(cycleWeek('2026-11-02', '2026-11-02', 0, 3)).toBe(0)
    expect(cycleWeek('2026-11-02', '2026-11-09', 0, 3)).toBe(1)
    expect(cycleWeek('2026-11-02', '2026-11-23', 0, 3)).toBe(0)     // wraps after three weeks
    expect(cycleWeek('2026-11-02', '2026-11-02', 1, 3)).toBe(1)     // offset staggers the team
    expect(shiftFor('2026-11-04', ROT, 0, SHIFTS).shift?.name).toBe('Morning')
    expect(shiftFor('2026-11-04', ROT, 1, SHIFTS).shift?.name).toBe('Evening')
    expect(shiftFor('2026-11-11', ROT, 0, SHIFTS).shift?.name).toBe('Evening')
    expect(shiftFor('2026-11-04', ROT, 2, SHIFTS).shift?.name).toBe('Night')
  })

  it('gives no shift on days the week does not cover, before the rotation starts, or without a rotation', () => {
    expect(shiftFor('2026-11-07', ROT, 0, SHIFTS)).toEqual({ shift: null, source: 'rotation' })   // Saturday
    expect(shiftFor('2026-10-26', ROT, 0, SHIFTS)).toEqual({ shift: null, source: 'none' })
    expect(shiftFor('2026-11-04', null, 0, SHIFTS)).toEqual({ shift: null, source: 'none' })
  })

  it('lets a day override win: a swap or a day off', () => {
    expect(shiftFor('2026-11-04', ROT, 0, SHIFTS, { shiftId: 'e', off: false })).toEqual({ shift: EVENING, source: 'override' })
    expect(shiftFor('2026-11-04', ROT, 0, SHIFTS, { shiftId: null, off: true })).toEqual({ shift: null, source: 'override' })
  })

  it('reads Nigerian time, not UTC', () => {
    expect(lagosNow(new Date('2026-11-16T23:30:00Z'))).toEqual({ day: '2026-11-17', minute: 30 })
  })

  it('decides who is on shift now, including overnight tails and grace', () => {
    const night = (day: string) => shiftFor(day, ROT, 2, SHIFTS).shift          // night shift on weekdays
    expect(onShiftAt(new Date('2026-11-04T22:00:00Z'), night)).toBe(true)       // Lagos 23:00 Wednesday
    expect(onShiftAt(new Date('2026-11-05T01:00:00Z'), night)).toBe(true)       // Lagos 02:00 Thursday: Wednesday night's tail
    expect(onShiftAt(new Date('2026-11-04T11:00:00Z'), night)).toBe(false)      // Lagos 12:00
    expect(onShiftAt(new Date('2026-11-04T20:50:00Z'), night, 0)).toBe(false)   // 21:50, ten minutes before the start
    expect(onShiftAt(new Date('2026-11-04T20:50:00Z'), night, 15)).toBe(true)   // with 15 minutes grace
    expect(onShiftAt(new Date('2026-11-07T01:00:00Z'), night)).toBe(true)       // early Saturday is still Friday night's shift
  })
})

describe('shifts, rotations and the roster', () => {
  let h: Harness
  beforeAll(async () => { h = await boot({ BEVERLY_READ_MODE: 'db' }) })
  beforeEach(async () => { await h.reset() })
  const ids: Record<string, string> = {}

  async function seed() {
    const adm = await h.as('admin1@x.test')
    for (const [k, name, start, end] of [['m', 'Morning', '06:00', '14:00'], ['e', 'Evening', '14:00', '22:00'], ['n', 'Night', '22:00', '06:00']] as const) {
      const r = await h.send('POST', '/api/admin/shifts/templates', adm, { name, start, end })
      expect(r.status).toBe(201); ids[k] = r.json.id
    }
    const rot = await h.send('POST', '/api/admin/shifts/rotations', adm, { name: 'Three week', anchorDate: '2026-11-02', steps: [{ shiftId: ids.m, days: WEEKDAYS }, { shiftId: ids.e, days: WEEKDAYS }, { shiftId: ids.n, days: WEEKDAYS }] })
    expect(rot.status).toBe(201); ids.rot = rot.json.id
    return adm
  }

  it('lets only admins define shifts, flags overnight ones, and refuses bad input and duplicates', async () => {
    const sup = await h.as('sup1@x.test'); const adm = await h.as('admin1@x.test')
    expect((await h.send('POST', '/api/admin/shifts/templates', sup, { name: 'X', start: '06:00', end: '14:00' })).status).toBe(403)
    const n = await h.send('POST', '/api/admin/shifts/templates', adm, { name: 'Night', start: '22:00', end: '06:00' })
    expect(n.json).toMatchObject({ overnight: true, start: '22:00', end: '06:00' })
    expect((await h.send('POST', '/api/admin/shifts/templates', adm, { name: 'Night', start: '01:00', end: '02:00' })).status).toBe(409)
    expect((await h.send('POST', '/api/admin/shifts/templates', adm, { name: 'Bad', start: '25:00', end: '02:00' })).status).toBe(400)
    expect((await h.send('POST', '/api/admin/shifts/templates', adm, { name: 'Same', start: '08:00', end: '08:00' })).status).toBe(400)
    expect((await h.get('/api/admin/shifts/templates', sup)).json).toHaveLength(1)
  })

  it('validates rotations: first week on a Monday, real shifts, and no deleting what is in use', async () => {
    const adm = await seed()
    expect((await h.send('POST', '/api/admin/shifts/rotations', adm, { name: 'Bad', anchorDate: '2026-11-03', steps: [{ shiftId: ids.m, days: [0] }] })).status).toBe(400)   // a Tuesday
    expect((await h.send('POST', '/api/admin/shifts/rotations', adm, { name: 'Ghost', anchorDate: '2026-11-02', steps: [{ shiftId: uid('ghost'), days: [0] }] })).status).toBe(400)
    expect((await h.send('DELETE', `/api/admin/shifts/templates/${ids.m}`, adm)).status).toBe(409)
    expect((await h.get('/api/admin/shifts/rotations', adm)).json[0]).toMatchObject({ name: 'Three week', agents: 0 })
  })

  it('assigns agents with an offset, builds the weekly roster and shows agents their own shifts', async () => {
    const adm = await seed()
    expect((await h.send('PUT', `/api/admin/shifts/assignments/${A1}`, adm, { rotationId: ids.rot, offsetWeeks: 0 })).status).toBe(204)
    expect((await h.send('PUT', `/api/admin/shifts/assignments/${A2}`, adm, { rotationId: ids.rot, offsetWeeks: 1 })).status).toBe(204)
    expect((await h.send('PUT', `/api/admin/shifts/assignments/${A2}`, adm, { rotationId: ids.rot, offsetWeeks: 3 })).status).toBe(400)   // beyond the cycle
    const sup = await h.as('sup1@x.test')
    const roster = (await h.get('/api/shifts/roster?from=2026-11-04', sup)).json
    expect(roster.from).toBe('2026-11-02'); expect(roster.days).toHaveLength(7)
    const a1 = roster.rows.find((r: { agentId: string }) => r.agentId === A1); const a2 = roster.rows.find((r: { agentId: string }) => r.agentId === A2)
    expect(a1.cells[2]).toMatchObject({ day: '2026-11-04', name: 'Morning', source: 'rotation' })
    expect(a2.cells[2]).toMatchObject({ name: 'Evening' })                       // staggered by one week
    expect(a1.cells[5]).toMatchObject({ name: null, source: 'rotation' })        // Saturday off
    expect(a1).toMatchObject({ rotationName: 'Three week', offsetWeeks: 0 })
    const agent = await h.as('agent1@x.test')
    const me = (await h.get('/api/shifts/me?from=2026-11-04', agent)).json
    expect(me.days).toHaveLength(14); expect(me.days[0]).toMatchObject({ name: 'Morning' })
    expect((await h.get('/api/shifts/roster', agent)).status).toBe(403)
  })

  it('applies day overrides for swaps and leave, and clears them', async () => {
    const adm = await seed()
    await h.send('PUT', `/api/admin/shifts/assignments/${A1}`, adm, { rotationId: ids.rot, offsetWeeks: 0 })
    expect((await h.send('PUT', '/api/admin/shifts/overrides', adm, { agentId: A1, day: '2026-11-04', shiftId: null, off: true, reason: 'Leave' })).status).toBe(204)
    expect((await h.send('PUT', '/api/admin/shifts/overrides', adm, { agentId: A1, day: '2026-11-05', shiftId: ids.n, off: false })).status).toBe(204)
    expect((await h.send('PUT', '/api/admin/shifts/overrides', adm, { agentId: A1, day: '2026-11-06', shiftId: null, off: false })).status).toBe(400)
    const sup = await h.as('sup1@x.test')
    const row = (await h.get('/api/shifts/roster?from=2026-11-02', sup)).json.rows.find((r: { agentId: string }) => r.agentId === A1)
    expect(row.cells[2]).toMatchObject({ name: null, source: 'override' }); expect(row.cells[3]).toMatchObject({ name: 'Night', source: 'override' })
    expect((await h.send('DELETE', `/api/admin/shifts/overrides?agentId=${A1}&day=2026-11-04`, adm)).status).toBe(204)
    const after = (await h.get('/api/shifts/roster?from=2026-11-02', sup)).json.rows.find((r: { agentId: string }) => r.agentId === A1)
    expect(after.cells[2]).toMatchObject({ name: 'Morning', source: 'rotation' })
    expect((await h.pool.query(`select 1 from call_centre.notifications where user_crm_id = $1 and title like 'Your shift on%'`, [A1])).rowCount).toBe(2)
    const acts = (await h.pool.query<{ action: string }>(`select action from call_centre.audit_log where action like 'shift.%'`)).rows.map((x) => x.action)
    expect(acts).toEqual(expect.arrayContaining(['shift.template.create', 'shift.rotation.create', 'shift.assign', 'shift.override', 'shift.override.clear']))
  })

  it('only routes calls to agents on shift once the admin turns enforcement on', async () => {
    const adm = await seed()
    const VOICE = '/api/webhooks/at/voice'
    const ev = (o: Record<string, string> = {}) => ({ sessionId: 'SH1', isActive: '1', callerNumber: '+2348035550142', direction: 'inbound', ...o })
    const online = async () => { const a = await h.as('agent1@x.test'); await h.send('PUT', '/api/presence', a, { status: 'available', languages: ['en'] }) }
    await online()
    // off by default: the agent gets the call even with no shift
    await hook(h, VOICE, ev()); expect((await hook(h, VOICE, ev({ dtmfDigits: '1' }))).body).toContain('Dial')
    await h.pool.query(`update call_centre.agent_presence set status = 'available'`)
    expect((await h.send('PUT', '/api/admin/settings/shift_policy', adm, { enforce: true, graceMinutes: 0 })).status).toBe(200)
    // enforced and the agent has no rotation: not on shift, so the caller is offered a callback
    await hook(h, VOICE, ev({ sessionId: 'SH2' })); expect((await hook(h, VOICE, ev({ sessionId: 'SH2', dtmfDigits: '1' }))).body).toContain('Reject')
    // an all-day shift today (Lagos) puts the agent on shift
    const now = lagosNow(new Date())
    const allDay = await h.send('POST', '/api/admin/shifts/templates', adm, { name: 'Allday', start: '00:00', end: '23:59' })
    await h.send('PUT', '/api/admin/shifts/overrides', adm, { agentId: A1, day: now.day, shiftId: allDay.json.id, off: false })
    const on = await agentsOnShift(h.pool, [A1, A2])
    expect(on.enforce).toBe(true); expect([...on.onShift]).toEqual([A1])
    await hook(h, VOICE, ev({ sessionId: 'SH3' })); expect((await hook(h, VOICE, ev({ sessionId: 'SH3', dtmfDigits: '1' }))).body).toContain('Dial')
  })
})

describe('staff photos are Beverly own', () => {
  let h: Harness
  beforeAll(async () => { h = await boot({ BEVERLY_READ_MODE: 'db' }) })
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 200 }, (_, i) => i % 255)]).toString('base64')

  it('uploads through the Beverly profile-picture flow, so the wallet and CRM show the same photo', async () => {
    const a = await h.as('agent1@x.test')
    PHOTO_CALLS.length = 0
    expect((await h.send('PUT', '/api/agents/me/photo', a, { contentType: 'image/jpeg', data: JPEG })).status).toBe(204)
    expect(PHOTO_CALLS).toEqual(['upload-url', expect.stringMatching(/^put:image\/jpeg:\d+$/), 'activate'])
    expect((await h.pool.query(`select 1 from call_centre.audit_log where action = 'agent.photo.set'`)).rowCount).toBe(1)
  })

  it('refuses another person photo, bad types, wrong signatures and oversized images', async () => {
    const a = await h.as('agent1@x.test'); const adm = await h.as('admin1@x.test')
    expect((await h.send('PUT', `/api/agents/${A2}/photo`, a, { contentType: 'image/jpeg', data: JPEG })).status).toBe(404)
    expect((await h.send('PUT', `/api/agents/${A2}/photo`, adm, { contentType: 'image/jpeg', data: JPEG })).status).toBe(404)   // even admins: it is the person own Beverly profile
    expect((await h.send('PUT', '/api/agents/me/photo', a, { contentType: 'image/gif', data: JPEG })).status).toBe(400)
    expect((await h.send('PUT', '/api/agents/me/photo', a, { contentType: 'image/png', data: JPEG })).status).toBe(400)
    expect((await h.send('PUT', '/api/agents/me/photo', a, { contentType: 'image/jpeg', data: Buffer.alloc(1_100_000, 0xff).toString('base64') })).status).toBe(400)
  })

  it('shows the photo Beverly holds for the staff member, from the shared staff record', async () => {
    const a = await h.as('agent1@x.test'); const sup = await h.as('sup1@x.test')
    expect((await h.get(`/api/agents/${A1}/photo`, a)).status).toBe(404)
    await h.pool.query(`insert into public.users (auth_user_id, user_name, email, role_key, portal_access, profile_picture_url) values ($1,'Aisha Bello','aisha@x.test','custom-call-centre-agent','{call}',$2)`, [A1, PHOTO_URL])
    const r = await h.app.inject({ url: `/api/agents/${A1}/photo`, headers: { cookie: a.cookie } })
    expect(r.statusCode).toBe(200); expect(r.headers['content-type']).toBe('image/jpeg'); expect(r.rawPayload.length).toBe(7)
    expect((await h.app.inject({ url: '/api/agents/me/photo', headers: { cookie: a.cookie } })).statusCode).toBe(200)
    await h.pool.query(`insert into call_centre.agent_presence (agent_crm_id, name, client_name, status, languages) values ($1,'Aisha Bello','cc.a','available','{en}') on conflict do nothing`, [A1])
    expect((await h.get(`/api/agents/${A1}/profile`, sup)).json.photoVersion).toMatch(/^[0-9a-f]{10}$/)
    const roster = (await h.get('/api/shifts/roster', sup)).json
    expect(roster.rows.find((x: { agentId: string }) => x.agentId === A1).hasPhoto).toBe(true)
  })

  it('never fetches a photo URL that is not in the Beverly profile-picture bucket', async () => {
    const a = await h.as('agent1@x.test')
    await h.pool.query(`update public.users set profile_picture_url = 'https://evil.test/wallet-profile-pictures/x.jpg' where auth_user_id = $1`, [A1])
    expect((await h.get(`/api/agents/${A1}/photo`, a)).status).toBe(404)
    await h.pool.query(`update public.users set profile_picture_url = 'https://auth.test/other-bucket/x.jpg' where auth_user_id = $1`, [A1])
    expect((await h.get(`/api/agents/${A1}/photo`, a)).status).toBe(404)
  })

  it('removes the photo from Beverly itself', async () => {
    const a = await h.as('agent1@x.test')
    PHOTO_CALLS.length = 0
    expect((await h.send('DELETE', '/api/agents/me/photo', a)).status).toBe(204)
    expect(PHOTO_CALLS).toEqual(['delete'])
    expect((await h.send('DELETE', `/api/agents/${A2}/photo`, a)).status).toBe(404)
  })
})
