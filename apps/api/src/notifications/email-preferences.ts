import type { NotificationType } from '../generated/prisma/client.js';

export const appointmentEmailTypes = ['APPOINTMENT_BOOKED', 'APPOINTMENT_CANCELLED'] as const;
export const offerEmailTypes = ['OFFER_CREATED', 'OFFER_ACCEPTED', 'OFFER_REJECTED', 'OFFER_EXPIRED'] as const;
export const emailPreferenceDisabled = 'EMAIL_PREFERENCE_DISABLED';
export type EmailPreferences = { appointmentEmailsEnabled: boolean; offerEmailsEnabled: boolean };

export function emailPreferenceKey(type: NotificationType): keyof EmailPreferences | undefined {
  if (appointmentEmailTypes.some(value => value === type)) return 'appointmentEmailsEnabled';
  if (offerEmailTypes.some(value => value === type)) return 'offerEmailsEnabled';
  return undefined;
}
export function disabledEmailTypes(preferences: EmailPreferences): NotificationType[] {
  return [...(preferences.appointmentEmailsEnabled ? [] : appointmentEmailTypes), ...(preferences.offerEmailsEnabled ? [] : offerEmailTypes)];
}
