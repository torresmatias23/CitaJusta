import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderEmailContent, renderEmailHtml, renderBookingEmailHtml } from '../dist/notifications/email-content.js';
import { notificationContent } from '../dist/notifications/notification-content.js';
import { loadEmailLogo } from '../dist/notifications/email-logo.js';
import { emailEligibleTypes, emailPayloadSchema } from '../dist/notifications/resend.client.js';

const booking = { type: 'APPOINTMENT_BOOKED', data: { startsAt: '2026-10-16T16:00:00.000Z' } };
const utcDate = (instant) => new Intl.DateTimeFormat('es-CL', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
}).format(new Date(instant));
const events = [
  booking,
  { type: 'APPOINTMENT_CANCELLED', data: { ...booking.data } },
  { type: 'OFFER_CREATED', data: { ...booking.data, expiresAt: '2026-10-15T16:10:00.000Z' } },
  { type: 'OFFER_ACCEPTED', data: { ...booking.data } },
  { type: 'OFFER_REJECTED', data: {} },
  { type: 'OFFER_EXPIRED', data: {} },
  { type: 'WAITLIST_ENTERED', data: {} },
  { type: 'WAITLIST_WITHDRAWN', data: {} },
];

test('booking renders a complete Spanish HTML email with explicit confirmation and plain text', () => {
  const rendered = renderEmailContent(booking, 'America/Santiago');
  assert.equal(rendered.subject, 'Reserva registrada');
  assert.match(rendered.text, /Tu reserva para .* quedó agendada\./);
  assert.match(rendered.html, /^<!DOCTYPE html>\s*<html lang="es">/);
  assert.match(rendered.html, /<head>[\s\S]*<meta charset="UTF-8" \/>[\s\S]*<\/head>/);
  assert.match(rendered.html, /<h1[^>]*>Tu reserva está registrada<\/h1>/);
  assert.match(rendered.html, /RESERVA CONFIRMADA EN EL SISTEMA/);
  assert.match(rendered.html, /DETALLES DE TU CITA/);
  assert.match(rendered.html, /Este comprobante de reserva no implica una confirmación de asistencia\./);
  assert.match(rendered.html, /AGENDADA/);
  assert.match(rendered.html, /CitaJusta/);
  assert.match(rendered.html, /Esta notificación fue generada automáticamente por CitaJusta\./);
  assert.match(rendered.html, /<\/body>\s*<\/html>$/);
  assert.match(rendered.html, /name="viewport"/);
  assert.match(rendered.html, /width:100%;max-width:600px/);
  assert.match(rendered.html, /role="presentation"/);
  assert.match(rendered.html, /<img src="cid:citajusta-logo" alt="CitaJusta" width="148" height="148"/);
  assert.doesNotMatch(rendered.html, /<(?:script|iframe|link|form|a)\b|\bon[a-z]+\s*=|https?:\/\/|data:image/i);
  for (const color of ['#172B50', '#008184', '#F3F8FB', '#FFFFFF', '#EDF8F8']) assert.ok(rendered.html.includes(color));
  assert.doesNotMatch(rendered.html, /Vista conceptual|Datos ficticios|No se envía ningún correo/);
  assert.doesNotMatch(rendered.html + rendered.text, /profesional|sucursal|sede|localhost|example\./i);
});

test('appointment date follows institutional Santiago DST and preserves explicit timezone, with UTC fallback', () => {
  // October is UTC-3; July is UTC-4. Both instants represent 13:00 locally.
  for (const startsAt of ['2026-10-16T16:00:00.000Z', '2026-07-16T17:00:00.000Z']) {
    const result = renderEmailContent({ ...booking, data: { startsAt } }, 'America/Santiago');
    // Render the known wall-clock date in UTC to avoid assuming ICU's 12/24h style.
    const expectedDate = utcDate(`${startsAt.slice(0, 10)}T13:00:00.000Z`);
    assert.equal(result.text, `Tu reserva para ${expectedDate} (America/Santiago) quedó agendada.`);
    assert.match(result.text, /\(America\/Santiago\)/);
    assert.match(result.html, /<strong>America\/Santiago<\/strong>/);
    assert.match(result.html, />13:00<\/p>/);
    const expectedFullDate = new Intl.DateTimeFormat('es-CL', { dateStyle: 'full', timeZone: 'UTC' })
      .format(new Date(`${startsAt.slice(0, 10)}T13:00:00.000Z`));
    assert.ok(result.html.includes(expectedFullDate));
  }
  const utc = renderEmailContent(booking);
  assert.equal(utc.text, `Tu reserva para ${utcDate(booking.data.startsAt)} (UTC) quedó agendada.`);
  assert.match(utc.html, />16:00<\/p>/);
  assert.match(utc.html, /<strong>UTC<\/strong>/);
});

test('all interpolated title and message characters are escaped and cannot create elements or attributes', () => {
  const html = renderEmailHtml('</title><script>alert("x")</script>', '<img src=x onerror="bad()"> & \'quoted\'');
  assert.match(html, /&lt;\/title&gt;&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=&quot;bad\(\)&quot;&gt; &amp; &#39;quoted&#39;/);
  assert.doesNotMatch(html, /<script\b|<img\b|<[^>]+\sonerror=/i);
});

test('booking, cancellation and offer messages remain semantically distinct', () => {
  for (const [type, title] of [
    ['APPOINTMENT_BOOKED', 'Reserva registrada'], ['APPOINTMENT_CANCELLED', 'Cita cancelada'],
    ['OFFER_CREATED', 'Recibiste una oferta'], ['OFFER_ACCEPTED', 'Oferta aceptada'],
    ['OFFER_REJECTED', 'Oferta rechazada'], ['OFFER_EXPIRED', 'Oferta vencida'],
  ]) {
    const data = ['OFFER_REJECTED', 'OFFER_EXPIRED'].includes(type) ? {} : {
      ...booking.data, ...(type === 'OFFER_CREATED' ? { expiresAt: '2026-10-15T16:10:00.000Z' } : {}),
    };
    const result = renderEmailContent({ type, data }, 'America/Santiago');
    assert.equal(result.subject, title);
    assert.ok(result.html.includes(`>${type === 'APPOINTMENT_BOOKED' ? 'Tu reserva está registrada' : title}</h1>`));
    if (type !== 'APPOINTMENT_BOOKED') assert.doesNotMatch(result.html, /Reserva registrada/);
    if (type !== 'APPOINTMENT_BOOKED') {
      assert.doesNotMatch(result.html, /AGENDADA|RESERVA CONFIRMADA EN EL SISTEMA|Tu reserva está registrada|confirmación de asistencia/);
      assert.deepEqual(result.attachments, [loadEmailLogo()]);
    }
    if (type === 'APPOINTMENT_CANCELLED') {
      assert.match(result.text, /^Se canceló tu reserva/);
      assert.doesNotMatch(result.text, /quedó agendada/);
    }
  }
});

test('HTML adapter leaves all internal notification contracts and wording unchanged', () => {
  assert.deepEqual(notificationContent(booking, 'America/Santiago'), {
    title: 'Reserva registrada',
    message: `Tu reserva para ${utcDate('2026-10-16T13:00:00.000Z')} (America/Santiago) quedó agendada.`,
    path: '/mis-citas',
  });
  const original = structuredClone(booking);
  const rendered = renderEmailContent(booking, 'America/Santiago');
  const internal = notificationContent(booking, 'America/Santiago');
  assert.equal(rendered.subject, internal.title);
  assert.equal(rendered.text, internal.message);
  assert.deepEqual(booking, original);
  assert.deepEqual(Object.keys(rendered).sort(), ['attachments', 'html', 'subject', 'text']);
});

test('booking stays readable without images and missing-logo fallback never uses broken or external sources', () => {
  const html = renderBookingEmailHtml(booking.data.startsAt, 'America/Santiago', false);
  assert.doesNotMatch(html, /<img\b|cid:|data:image|https?:\/\//);
  for (const text of ['CitaJusta', 'Tu reserva está registrada', '13:00', 'America/Santiago', 'AGENDADA', 'Mis citas']) {
    assert.ok(html.includes(text));
  }
  const blockedImages = renderEmailContent(booking, 'America/Santiago').html.replace(/<img\b[^>]*\/>/g, '');
  assert.match(blockedImages, /Tu reserva está registrada/);
  assert.match(blockedImages, /13:00/);
  assert.match(blockedImages, /Esta notificación fue generada automáticamente por CitaJusta/);
});

test('invalid or extra event data cannot introduce HTML or unverified appointment details', () => {
  for (const value of [
    { ...booking, data: { startsAt: '<script>invalid</script>' } },
    { ...booking, data: { ...booking.data, branch: 'Unverified branch' } },
    { type: 'UNKNOWN', data: {} },
  ]) assert.throws(() => renderEmailContent(value, 'America/Santiago'));
});

for (const event of events) {
  test(`${event.type}: shared booking identity, validated CID, unchanged subject/text and no invented details`, () => {
    const original = structuredClone(event);
    const rendered = renderEmailContent(event, 'America/Santiago');
    const content = notificationContent(event, 'America/Santiago');
    assert.equal(rendered.subject, content.title); assert.equal(rendered.text, content.message);
    assert.ok(rendered.html.includes(`<title>${event.type === 'APPOINTMENT_BOOKED' ? 'Tu reserva está registrada' : content.title} | CitaJusta</title>`));
    assert.deepEqual(event, original);
    assert.match(rendered.html, /^<!DOCTYPE html>\s*<html lang="es">/);
    assert.match(rendered.html, /name="viewport"/);
    for (const color of ['#172B50', '#008184', '#F3F8FB', '#FFFFFF', '#EDF8F8']) assert.ok(rendered.html.includes(color));
    assert.match(rendered.html, /background-color:#FFFFFF;border:1px solid #dce8ef;border-radius:16px/);
    assert.match(rendered.html, /padding:0 24px;border-bottom:4px solid #008184/);
    assert.match(rendered.html, /width:100%;max-width:600px/);
    assert.match(rendered.html, /role="presentation"/);
    assert.match(rendered.html, /src="cid:citajusta-logo" alt="CitaJusta" width="148" height="148"/);
    assert.match(rendered.html, /Esta notificación fue generada automáticamente por CitaJusta\./);
    assert.doesNotMatch(rendered.html, /#14345c|#2563a6|<(?:script|iframe|link|form|a)\b|\bon[a-z]+\s*=|https?:\/\/|data:image/i);
    assert.doesNotMatch(rendered.html + rendered.text, /profesional|sucursal|sede|localhost|example\./i);
    assert.deepEqual(rendered.attachments, [loadEmailLogo()]);
    const payload = { from: 'CitaJusta <fixture@example.test>', to: ['recipient@example.test'], ...rendered };
    assert.deepEqual(emailPayloadSchema.parse(payload), payload);
    const reference = renderBookingEmailHtml(booking.data.startsAt, 'America/Santiago', true);
    const header = html => html.slice(html.indexOf('<body'), html.indexOf('<tr><td style="padding:32px 24px;">'));
    const footer = html => html.slice(html.indexOf('<tr><td style="padding:24px;border-top:'));
    assert.equal(header(rendered.html), header(reference)); assert.equal(footer(rendered.html), footer(reference));
    const withoutImages = rendered.html.replace(/<img\b[^>]*\/>/g, '');
    assert.match(withoutImages, /<h1\b/); assert.match(withoutImages, /CitaJusta/);
    if (event.type !== 'APPOINTMENT_BOOKED') assert.ok(withoutImages.includes(content.message));
  });
}

test('missing logo uses safe text branding for every event, without CID or attachments', () => {
  for (const event of events) {
    let reads = 0;
    const rendered = renderEmailContent(event, 'America/Santiago', () => loadEmailLogo(() => {
      reads++; throw Object.assign(new Error('not found'), { code: 'ENOENT' });
    }));
    assert.equal(reads, 1);
    assert.doesNotMatch(rendered.html, /<img\b|cid:|data:image|https?:\/\//);
    assert.equal(Object.hasOwn(rendered, 'attachments'), false);
    assert.match(rendered.html, /CitaJusta/);
    const content = notificationContent(event, 'America/Santiago');
    assert.equal(rendered.subject, content.title); assert.equal(rendered.text, content.message);
    assert.equal(emailPayloadSchema.safeParse({ from: 'fixture@example.test', to: ['recipient@example.test'], ...rendered }).success, true);
  }
});

test('offer deadlines and other appointment events retain institutional DST and UTC formatting', () => {
  for (const timeZone of ['America/Santiago', 'UTC']) {
    for (const startsAt of ['2026-10-16T16:00:00.000Z', '2026-07-16T17:00:00.000Z']) {
      const expiresAt = new Date(Date.parse(startsAt) - 600_000).toISOString();
      for (const type of ['APPOINTMENT_CANCELLED', 'OFFER_CREATED', 'OFFER_ACCEPTED']) {
        const event = { type, data: { startsAt, ...(type === 'OFFER_CREATED' ? { expiresAt } : {}) } };
        const rendered = renderEmailContent(event, timeZone);
        const formatted = instant => new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(instant));
        assert.ok(rendered.html.includes(`${formatted(startsAt)} (${timeZone})`));
        if (type === 'OFFER_CREATED') assert.ok(rendered.html.includes(`con plazo hasta ${formatted(expiresAt)} (${timeZone})`));
        assert.equal(rendered.text, notificationContent(event, timeZone).message);
      }
    }
  }
});

test('untrusted HTML remains escaped even with the shared CID header and invalid event data is rejected before logo loading', () => {
  const html = renderEmailHtml('<svg onload="bad()"> & \'title\'', '</p><script>bad()</script><img src=x onerror="bad()">', true);
  assert.match(html, /&lt;svg onload=&quot;bad\(\)&quot;&gt; &amp; &#39;title&#39;/);
  assert.match(html, /&lt;\/p&gt;&lt;script&gt;bad\(\)&lt;\/script&gt;&lt;img src=x onerror=&quot;bad\(\)&quot;&gt;/);
  assert.equal((html.match(/<img\b/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<(?:script|svg)\b|<img src=x|<[^>]+\son(?:error|load)=/i);
  for (const event of events) {
    for (const extra of [{ html: '<script>bad()</script>' }, { url: 'https://untrusted.example' }, { startsAt: '<img src=x>' }]) {
      let reads = 0;
      assert.throws(() => renderEmailContent({ ...event, data: { ...event.data, ...extra } }, 'UTC', () => { reads++; return undefined; }));
      assert.equal(reads, 0);
    }
  }
});

test('HTML unification does not enable additional delivery events', () => {
  assert.deepEqual([...emailEligibleTypes].sort(), ['APPOINTMENT_BOOKED', 'APPOINTMENT_CANCELLED', 'OFFER_ACCEPTED', 'OFFER_CREATED', 'OFFER_EXPIRED', 'OFFER_REJECTED']);
});
