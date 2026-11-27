// BDD stubs for `test/customapp-outbox.test.js`
// Session: custom-app-yep-2026-registration-20261127-0748. Contract: ../acceptance-contract.md.
// Each it() fails until the criterion is implemented and its real test replaces the stub.
import { describe, it } from 'node:test';

describe('US-023: Email outbox', () => {
  // AC-150 (unit-test) → test/customapp-outbox.test.js
  it('GIVEN server/helpdesk.js WHEN smtpOptions() and canEmail() are extracted into mailTransport(db) THEN the helpdesk and the outbox use the same transport and the helpdesk tests stay green', () => {
    throw new Error('Not implemented — AC-150 pending');
  });
  // AC-151 (unit-test) → test/customapp-outbox.test.js
  it('GIVEN a seat confirmed or changed for guests with and without an address WHEN afterCommit runs THEN an assignment or update message is queued after the save with a body from the seat snapshot, and the guest with no address is marked not applicable', () => {
    throw new Error('Not implemented — AC-151 pending');
  });
  // AC-152 (integration-test) → test/customapp-outbox.test.js
  it('GIVEN three queued messages and fakeSmtp WHEN the drain runs THEN they are sent one at a time in order, outside commit(), as queued to sending to sent, and status writes are debounced to one save every 2 s', () => {
    throw new Error('Not implemented — AC-152 pending');
  });
  // AC-153 (integration-test) → test/customapp-outbox.test.js
  it('GIVEN fakeSmtp failing transiently and then permanently WHEN a message is drained THEN it is retried three times with backoff and seat and arrival are untouched', () => {
    throw new Error('Not implemented — AC-153 pending');
  });
  // AC-154 (integration-test) → test/customapp-outbox.test.js
  it('GIVEN a failed message WHEN staff press Resend THEN a notify command creates a new attempt', () => {
    throw new Error('Not implemented — AC-154 pending');
  });
  // AC-155 (unit-test) → test/customapp-outbox.test.js
  it('GIVEN emailPaused true WHEN seats are confirmed THEN messages are queued and none is sent', () => {
    throw new Error('Not implemented — AC-155 pending');
  });
  // AC-156 (unit-test) → test/customapp-outbox.test.js
  it('GIVEN a message left in sending for 3 minutes WHEN the server restarts THEN it is queued again', () => {
    throw new Error('Not implemented — AC-156 pending');
  });
  // AC-157 (unit-test) → test/customapp-outbox.test.js
  it('GIVEN an event with emailFrom and replyTo and a guest named José Ñúñez WHEN the message is composed THEN it uses the event\'s From and Reply-To, never the helpdesk mailbox, and the name is an encoded word', () => {
    throw new Error('Not implemented — AC-157 pending');
  });
});
