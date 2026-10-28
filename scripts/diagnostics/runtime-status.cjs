/** Read-only snapshot of the local acceptance deployment and fixture cleanup. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { requireDependency, requiredEnv } = require('../runtime.cjs');
const { MongoClient, ObjectId } = requireDependency('mongodb');
const reportDir = path.resolve(__dirname, '../../docs/acceptance');
const kubeconfig = path.resolve(__dirname, '../../kubeconfig-prod.utf8');
const context = 'kind-medibrain-prod';
const kubectl = (args) => execFileSync('kubectl', ['--kubeconfig', kubeconfig, '--context', context, ...args], { encoding: 'utf8' });
async function main() {
  const deployments = JSON.parse(kubectl(['get', 'deployments', '-n', 'medibrain', '-o', 'json'])).items
    .filter((item) => ['medibrain-server', 'medibrain-web'].includes(item.metadata.name))
    .map((item) => ({ name: item.metadata.name, desired: item.spec.replicas, ready: item.status.readyReplicas, updated: item.status.updatedReplicas, images: item.spec.template.spec.containers.map((container) => container.image) }));
  assert.equal(deployments.length, 2);
  for (const deployment of deployments) {
    assert.equal(deployment.ready, deployment.desired);
    assert.equal(deployment.updated, deployment.desired);
  }
  const pods = JSON.parse(kubectl(['get', 'pods', '-n', 'medibrain', '-o', 'json'])).items
    .filter((item) => ['medibrain-server', 'medibrain-web'].includes(item.metadata.labels?.app) && !item.metadata.deletionTimestamp)
    .map((item) => ({ name: item.metadata.name, node: item.spec.nodeName, containers: (item.status.containerStatuses ?? []).map(({ name, ready, image, imageID, restartCount }) => ({ name, ready, image, imageID, restartCount })) }));
  const health = await fetch('http://localhost:8090/api/health', { signal: AbortSignal.timeout(10_000) }).then((response) => response.json());
  assert.equal(health.status, 'ok');
  const mongo = new MongoClient(requiredEnv('MONGO_URI'));
  let cleanup;
  try {
    await mongo.connect();
    const fixturePattern = /^(?:codex-(?:ui-|accept-|smoke-|library-)|single-user-|conversation-)/;
    const fixtures = await mongo.db().collection('users').find({ username: fixturePattern }).project({ _id: 1 }).toArray();
    const temporaryHistory = await mongo.db().collection('qa_records').find({ username: fixturePattern }).project({ userId: 1 }).toArray();
    // Locks are checked only for IDs proven to belong to temporary accounts/history.
    // Cleanup reports also verify these exact IDs before their fixture users disappear.
    const ids = [...new Set([...fixtures.map((user) => user._id.toString()), ...temporaryHistory.map((record) => record.userId)])]
      .filter((id) => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id));
    cleanup = {
      temporaryUsers: fixtures.length,
      temporaryHistory: temporaryHistory.length,
      temporaryOwnerIdsChecked: ids.length,
      temporaryConversations: await mongo.db().collection('qa_conversations').countDocuments({ userId: { $in: ids } }),
      temporaryAccountLocks: await mongo.db().collection('qa_account_locks').countDocuments({ _id: { $in: ids.map((id) => new ObjectId(id)) } }),
      conversationAndLockScope: 'temporary-user-or-history-owner-ids-only',
      ownedCleanupEvidence: 'docs/acceptance/conversations-latest.json#fixtureCleanup',
    };
    assert.equal(cleanup.temporaryUsers, 0, 'Temporary acceptance users remain');
    assert.equal(cleanup.temporaryHistory, 0, 'Temporary acceptance history remains');
    assert.equal(cleanup.temporaryConversations, 0, 'Temporary acceptance conversations remain');
    assert.equal(cleanup.temporaryAccountLocks, 0, 'Temporary acceptance account locks remain');
  } finally { await mongo.close(); }
  const acceptance = Object.fromEntries(['content', 'performance', 'cold'].map((mode) => {
    const report = JSON.parse(fs.readFileSync(path.join(reportDir, mode + '-latest.json'), 'utf8'));
    assert.equal(report.status, 'passed');
    assert.equal(report.cleanup, true);
    return [mode, { runId: report.runId, timestamp: report.timestamp, status: report.status, cleanup: report.cleanup }];
  }));
  // Browser observations are documented separately; this CLI does not replay them.
  const singleLoginAcceptance = JSON.parse(fs.readFileSync(path.join(reportDir, 'single-user-latest.json'), 'utf8'));
  const classificationMigration = JSON.parse(fs.readFileSync(path.join(reportDir, 'user-login-migration-latest.json'), 'utf8'));
  const conversationsAcceptance = JSON.parse(fs.readFileSync(path.join(reportDir, 'conversations-latest.json'), 'utf8'));
  assert.equal(singleLoginAcceptance.status, 'passed');
  assert.equal(singleLoginAcceptance.fixtureCleanup, 'passed');
  assert.equal(classificationMigration.status, 'passed');
  assert.equal(conversationsAcceptance.status, 'passed');
  assert.equal(conversationsAcceptance.fixtureCleanup.status, 'passed');
  const report = { timestamp: new Date().toISOString(), status: 'passed', kubernetesContext: context, deployments, pods, health, cleanup, acceptance, singleLoginAcceptance, classificationMigration, conversationsAcceptance, browserEvidenceRecord: 'docs/conversations-2026-10-14.md' };
  fs.writeFileSync(path.join(reportDir, 'runtime-latest.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, deployments, health: health.status, cleanup, acceptance, conversationsAcceptance: { checkedAt: conversationsAcceptance.checkedAt, status: conversationsAcceptance.status, fixtureCleanup: conversationsAcceptance.fixtureCleanup } }));
}
main().catch((error) => { console.error(JSON.stringify({ runtimeSnapshotFailed: error.message })); process.exitCode = 1; });
