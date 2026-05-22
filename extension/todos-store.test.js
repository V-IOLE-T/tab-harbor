'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  completeTodo,
  clearArchivedTodos,
  createTodo,
  deleteTodo,
  normalizeTodos,
  searchTodos,
  splitTodos,
  updateTodo,
} = require('./todos-store.js');

test('createTodo adds a new active todo with title and description', () => {
  const todos = createTodo([], {
    title: 'Write launch post',
    description: 'Draft the outline before dinner',
  });

  assert.equal(todos.length, 1);
  assert.equal(todos[0].title, 'Write launch post');
  assert.equal(todos[0].completed, false);
});

test('completeTodo archives a todo without dismissing it', () => {
  const todos = completeTodo([
    {
      id: 'todo-1',
      title: 'Review notes',
      description: '',
      createdAt: '2026-04-16T00:00:00.000Z',
      completed: false,
      completedAt: null,
      dismissed: false,
    },
  ], 'todo-1');

  const { active, archived } = splitTodos(todos);
  assert.equal(active.length, 0);
  assert.equal(archived.length, 1);
  assert.equal(archived[0].completed, true);
});

test('deleteTodo hides a todo from both active and archive views', () => {
  const todos = deleteTodo([
    {
      id: 'todo-1',
      title: 'Review notes',
      description: '',
      createdAt: '2026-04-16T00:00:00.000Z',
      completed: true,
      completedAt: '2026-04-16T01:00:00.000Z',
      dismissed: false,
    },
  ], 'todo-1');

  const { active, archived } = splitTodos(todos);
  assert.equal(active.length, 0);
  assert.equal(archived.length, 0);
});

test('updateTodo edits title and description without changing completion state', () => {
  const todos = updateTodo([
    {
      id: 'todo-1',
      title: 'Review notes',
      description: 'Old context',
      createdAt: '2026-04-16T00:00:00.000Z',
      completed: true,
      completedAt: '2026-04-16T01:00:00.000Z',
      dismissed: false,
    },
  ], 'todo-1', {
    title: '  Review launch notes  ',
    description: '  New context  ',
    completed: false,
    dismissed: true,
  });

  assert.equal(todos[0].title, 'Review launch notes');
  assert.equal(todos[0].description, 'New context');
  assert.equal(todos[0].completed, true);
  assert.equal(todos[0].dismissed, false);
});

test('updateTodo rejects an empty title', () => {
  assert.throws(() => updateTodo([
    {
      id: 'todo-1',
      title: 'Review notes',
      description: '',
      createdAt: '2026-04-16T00:00:00.000Z',
      completed: false,
      completedAt: null,
      dismissed: false,
    },
  ], 'todo-1', { title: '   ' }), /Todo title is required/);
});

test('clearArchivedTodos removes all archived todos but keeps active ones', () => {
  const todos = clearArchivedTodos([
    {
      id: 'todo-1',
      title: 'Archived item',
      description: '',
      createdAt: '2026-04-16T00:00:00.000Z',
      completed: true,
      completedAt: '2026-04-16T01:00:00.000Z',
      dismissed: false,
    },
    {
      id: 'todo-2',
      title: 'Active item',
      description: '',
      createdAt: '2026-04-16T00:00:00.000Z',
      completed: false,
      completedAt: null,
      dismissed: false,
    },
  ]);

  const { active, archived } = splitTodos(todos);
  assert.equal(active.length, 1);
  assert.equal(archived.length, 0);
});

test('searchTodos matches title and description text', () => {
  const todos = normalizeTodos([
    {
      id: 'todo-1',
      title: 'Write docs',
      description: 'Update onboarding page',
      createdAt: '2026-04-16T00:00:00.000Z',
      completed: false,
      completedAt: null,
      dismissed: false,
    },
    {
      id: 'todo-2',
      title: 'Prep launch',
      description: 'Draft release copy',
      createdAt: '2026-04-16T00:00:00.000Z',
      completed: false,
      completedAt: null,
      dismissed: false,
    },
  ]);

  assert.equal(searchTodos(todos, 'onboarding').length, 1);
  assert.equal(searchTodos(todos, 'launch').length, 1);
});
