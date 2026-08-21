'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const polling = require('../pollingController');

function fakeMainloop() {
    let nextId = 1;
    const sources = new Map();
    let invalidRemovals = 0;

    return {
        addTimeoutSeconds(seconds, callback) {
            const id = nextId++;
            sources.set(id, { seconds, callback });
            return id;
        },
        removeSource(id) {
            if (!sources.delete(id))
                invalidRemovals++;
        },
        sourceExists(id) {
            return sources.has(id);
        },
        drop(id) {
            sources.delete(id);
        },
        fire(id) {
            const source = sources.get(id);
            assert.ok(source, `source ${id} should exist`);
            const keep = source.callback();
            if (!keep)
                sources.delete(id);
        },
        get invalidRemovals() {
            return invalidRemovals;
        },
    };
}

function createController(loop, poll, onError = () => {}) {
    return polling.create({
        addTimeoutSeconds: loop.addTimeoutSeconds,
        removeSource: loop.removeSource,
        sourceExists: loop.sourceExists,
        intervalSeconds: () => 5,
        watchdogIntervalSeconds: () => 5,
        poll,
        onError,
    });
}

test('watchdog recreates a polling source that disappeared', () => {
    const loop = fakeMainloop();
    let refreshes = 0;
    const controller = createController(loop, () => refreshes++);
    controller.start();

    const original = controller.sourceIds();
    loop.drop(original.pollId);
    loop.fire(original.watchdogId);

    const recovered = controller.sourceIds();
    assert.notEqual(recovered.pollId, original.pollId);
    assert.equal(loop.sourceExists(recovered.pollId), true);
    assert.equal(loop.sourceExists(recovered.watchdogId), true);
    assert.equal(refreshes, 1);
});

test('a thrown refresh is reported and the next poll is rearmed', () => {
    const loop = fakeMainloop();
    const errors = [];
    const controller = createController(loop, () => {
        throw new Error('refresh exploded');
    }, error => errors.push(error));
    controller.start();

    const firstPollId = controller.sourceIds().pollId;
    loop.fire(firstPollId);

    const nextPollId = controller.sourceIds().pollId;
    assert.notEqual(nextPollId, firstPollId);
    assert.equal(loop.sourceExists(nextPollId), true);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /refresh exploded/);
});

test('restart and stop never remove an already-missing source ID', () => {
    const loop = fakeMainloop();
    const controller = createController(loop, () => {});
    controller.start();

    loop.drop(controller.sourceIds().pollId);
    controller.restart();
    assert.equal(loop.invalidRemovals, 0);
    assert.ok(controller.sourceIds().pollId);
    assert.ok(controller.sourceIds().watchdogId);

    controller.stop();
    assert.deepEqual(controller.sourceIds(), { pollId: 0, watchdogId: 0 });
    assert.equal(loop.invalidRemovals, 0);
});
