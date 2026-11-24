// What GitHub may ask the ATLAS server to do (deploy/aws/github-ops.yaml, EC2.md "Updates from
// GitHub"): "status" or "update" through the ltdc-lms-ops command, from one branch, on one server.
// Never a console, any command, or upgrade-server.sh (root code from the branch: a person runs it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const tpl = fs.readFileSync(new URL('../deploy/aws/github-ops.yaml', import.meta.url), 'utf8');
const wf = fs.readFileSync(new URL('../../.github/workflows/atlas-update.yml', import.meta.url), 'utf8');

test('GitHub may only ask the ATLAS server for its status or an update', () => {
  assert.match(tpl, /allowedValues: \[status, update\]/);
  assert.doesNotMatch(tpl, /upgrade-server\.sh[^\n]*(runCommand|bash)/, 'upgrade-server.sh is run by a person, not by GitHub');
  assert.doesNotMatch(tpl, /AWS-RunShellScript|AWS-StartInteractiveCommand|ssm:StartSession|"\*"\s*$|Action: ssm:\*/m, 'no shell, no console, no other actions');
  assert.match(tpl, /Action: ssm:SendCommand\n\s+Resource:\n\s+- !Sub arn:aws:ec2:\$\{AWS::Region\}:\$\{AWS::AccountId\}:instance\/\$\{InstanceId\}\n\s+- !Sub arn:aws:ssm:[^\n]*document\/\$\{OpsDocument\}/, 'one server, one document');
  assert.match(tpl, /token\.actions\.githubusercontent\.com:sub: !Sub repo:\$\{GitHubRepository\}:ref:refs\/heads\/\$\{DeployBranch\}/, 'one branch only');
  // The workflow sends only those two, and tests on every Node.js a server may run first.
  assert.match(wf, /--document-name ltdc-lms-ops/);
  assert.match(wf, /\^\(update\|status\)\$/);
  assert.match(wf, /node: \[18, 20, 22\]/);
  assert.match(wf, /needs: test/);
});
