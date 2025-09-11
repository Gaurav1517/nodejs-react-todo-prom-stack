import React, { useState, useEffect } from 'react'

// Use env var if available, otherwise fallback to localhost:4000
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

export default function App() {
  const [todos, setTodos] = useState([])
  const [title, setTitle] = useState('')

  async function load() {
    try {
      const res = await fetch(`${API_URL}/todos`)
      const data = await res.json()
      setTodos(data)
    } catch (err) {
      console.error("Error fetching todos:", err)
    }
  }

  useEffect(() => { load() }, [])

  async function addTodo(e) {
    e.preventDefault()
    try {
      await fetch(`${API_URL}/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
      })
      setTitle('')
      load()
    } catch (err) {
      console.error("Error adding todo:", err)
    }
  }

  async function toggle(id, done) {
    try {
      await fetch(`${API_URL}/todos/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: !done })
      })
      load()
    } catch (err) {
      console.error("Error toggling todo:", err)
    }
  }

  async function del(id) {
    try {
      await fetch(`${API_URL}/todos/${id}`, { method: 'DELETE' })
      load()
    } catch (err) {
      console.error("Error deleting todo:", err)
    }
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial' }}>
      <h1>React TODO App</h1>
      <form onSubmit={addTodo}>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="New todo"
        />
        <button>Add</button>
      </form>
      <ul>
        {todos.map(t => (
          <li key={t._id}>
            {t.title} {t.done ? "(done)" : ""}
            <button onClick={() => toggle(t._id, t.done)}>Toggle</button>
            <button onClick={() => del(t._id)}>Delete</button>
          </li>
        ))}
      </ul>
      <p>
        Backend health:{" "}
        <a href={`${API_URL.replace('/api','')}/api/health`} target="_blank" rel="noreferrer">
          /api/health
        </a>
      </p>
      <p>
        Metrics:{" "}
        <a href={`${API_URL.replace('/api','')}/metrics`} target="_blank" rel="noreferrer">
          /metrics
        </a>
      </p>
      <p>Logs (Loki): view in Grafana Explore → Loki</p>
    </div>
  )
}
