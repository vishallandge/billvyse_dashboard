// Shared between the bell dropdown (DashboardShell) and the full /seller/notifications
// page, so a feed item translates to the exact same sentence in both places.
export function notificationHeadline(t, item) {
  if (item.key === 'backupReminder') {
    return item.params.days == null
      ? t('notifications.headline.backupReminderNever')
      : t('notifications.headline.backupReminderDays', item.params);
  }
  return t(`notifications.headline.${item.key}`, item.params);
}
