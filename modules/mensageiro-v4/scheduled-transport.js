"use strict";

// Financial adapter for the existing V3 scheduler. No timer, listener or queue.
async function sendScheduled({ store, repository, scope, credits, workspaceId, profileId, sessionId,
  destination, content, claimKey, transport, authorized, currentSocket, recoveryDisabled = () => false }) {
  const p = store.getProfile(workspaceId, profileId);
  const parent = store.state.workspaces[workspaceId]?.claims[claimKey];
  const schedule = parent && store.getSchedule(workspaceId, parent.scheduleId);
  if (!p || !schedule || parent.profileId !== profileId || parent.destination !== destination)
    throw new Error("programacao_v3_invalida");
  const profileRevision = p.revision, scheduleRevision = schedule.revision;
  const revalidate = async () => {
    const valid = await repository.call("scheduled_authorize", { workspaceId, profileId, sessionId,
      card: "scheduled", expectedRevision: profileRevision, scheduleId: schedule.id, scheduleRevision, destination });
    if (!valid || !authorized(workspaceId, sessionId, destination) ||
        !currentSocket() || recoveryDisabled()) throw new Error("context_changed");
  };
  return scope.withTarget({ workspaceId, sessionId, profileId, groupId: destination,
    cards: ["scheduled"], destinations: [destination] }, () => credits.send({ workspaceId,
      sessionId, profileId, groupId: destination, parentKey: claimKey, slot: 1,
      revalidate, content, transport }));
}
module.exports = { sendScheduled };
