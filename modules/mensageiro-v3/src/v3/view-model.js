function buildViewModel(store, workspaceId, now = Date.now()) {
  const profiles = store.listProfiles(workspaceId).map(profile => ({
    id: profile.id,
    workspaceId: profile.workspaceId,
    name: profile.name,
    active: profile.active === true,
    sessionId: profile.sessionId,
    // Card configuration is part of the same persisted V3 authority. Keep it
    // in the authenticated view so a refresh cannot silently fall back to the
    // legacy configuration or show a false save confirmation.
    cards: profile.cards,
    destinations: profile.destinations
  }));
  const profileIds = new Set(profiles.map(profile => profile.id));
  const schedules = store.listSchedules(workspaceId, { includeInactive: true })
    .filter(schedule => profileIds.has(schedule.profileId))
    .map(schedule => ({
      id: schedule.id,
      workspaceId: schedule.workspaceId,
      profileId: schedule.profileId,
      name: schedule.name,
      active: schedule.active === true,
      timezone: schedule.timezone,
      intervalMs: schedule.intervalMs,
      nextRunAt: schedule.nextRunAt,
      destinations: schedule.destinations,
      content: schedule.content,
      artifactId: schedule.artifactId,
      due: Boolean(schedule.active === true && schedule.nextRunAt && Date.parse(schedule.nextRunAt) <= now &&
        profiles.find(profile => profile.id === schedule.profileId)?.active === true &&
        profiles.find(profile => profile.id === schedule.profileId)?.cards?.scheduled?.active === true)
    }));
  return { workspaceId: String(workspaceId), profiles, schedules };
}

module.exports = { buildViewModel };
