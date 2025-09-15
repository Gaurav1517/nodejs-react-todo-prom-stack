// frontend/src/App.jsx
import React, { useState, useEffect } from 'react'

// Use env var if available, otherwise fallback to localhost:4000
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

export default function App() {
  const [todos, setTodos] = useState([])
  const [title, setTitle] = useState('')
  const [duration, setDuration] = useState(60)
  const [clients, setClients] = useState(10)
  const [tests, setTests] = useState([])
  const [selectedLog, setSelectedLog] = useState('')

  async function load() {
    try {
      const res = await fetch(`${API_URL}/todos`)
      const data = await res.json()
      setTodos(data)
    } catch (err) {
      console.error("Error fetching todos:", err)
    }
  }

  useEffect(() => { load(); fetchTests(); }, [])

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

  // Load test functions
  async function startLoadTest() {
    try {
      const res = await fetch(`${API_URL}/load-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration: Number(duration), clients: Number(clients) })
      })
      const data = await res.json()
      alert('Load test started, id: ' + (data.testId || data.testId))
      fetchTests()
    } catch (err) {
      console.error("Error starting load test:", err)
    }
  }

  async function stopLoadTest(id) {
    try {
      const res = await fetch(`${API_URL}/load-test/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testId: id })
      })
      const data = await res.json()
      alert(data.message || 'Stop requested')
      fetchTests()
    } catch (err) {
      console.error("Error stopping load test:", err)
    }
  }

  async function fetchTests() {
    try {
      const res = await fetch(`${API_URL}/load-tests`)
      const data = await res.json()
      setTests(data)
    } catch (err) {
      console.error("Error fetching load tests:", err)
    }
  }

  async function viewLog(id) {
    try {
      const res = await fetch(`${API_URL}/load-test/${id}/log`)
      if (!res.ok) {
        setSelectedLog('No log available')
        return
      }
      const txt = await res.text()
      setSelectedLog(txt)
    } catch (err) {
      console.error("Error fetching log:", err)
      setSelectedLog('Error fetching log')
    }
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial' }}>
      <h1>React TODO App</h1>

      <form onSubmit={addTodo}>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="New todo" />
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

      <hr />

      <h2>Load Test</h2>
      <div>
        <label>Duration (s): </label>
        <input type="number" value={duration} onChange={e => setDuration(e.target.value)} />
        <label style={{ marginLeft: 10 }}>Clients: </label>
        <input type="number" value={clients} onChange={e => setClients(e.target.value)} />
        <button onClick={startLoadTest} style={{ marginLeft: 10 }}>Start</button>
      </div>

      <h3>Recent Load Tests</h3>
      <button onClick={fetchTests}>Refresh</button>
      <ul>
        {tests.map(t => (
          <li key={t._id}>
            {new Date(t.startTime).toLocaleString()} — {t.status} — clients:{t.clients} dur:{t.duration}s
            {t.pid ? ` pid:${t.pid}` : null}
            <button onClick={() => stopLoadTest(t._id)} style={{ marginLeft: 8 }}>Stop</button>
            <button onClick={() => viewLog(t._id)} style={{ marginLeft: 8 }}>View log</button>
          </li>
        ))}
      </ul>

      <h3>Selected Log</h3>
      <pre style={{ whiteSpace: 'pre-wrap', background:'#f5f5f5', padding:10 }}>{selectedLog}</pre>

      <hr />
      <p>Backend health: <a href={`${API_URL.replace('/api','')}/api/health`} target="_blank" rel="noreferrer">/api/health</a></p>
      <p>Metrics: <a href={`${API_URL.replace('/api','')}/metrics`} target="_blank" rel="noreferrer">/metrics</a></p>
      <p>Logs (Loki): view in Grafana Explore → Loki</p>
    </div>
  )
}


// import React, { useState, useEffect } from 'react'

// // Use env var if available, otherwise fallback to localhost:4000
// const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

// export default function App() {
//   const [todos, setTodos] = useState([])
//   const [title, setTitle] = useState('')

//   async function load() {
//     try {
//       const res = await fetch(`${API_URL}/todos`)
//       const data = await res.json()
//       setTodos(data)
//     } catch (err) {
//       console.error("Error fetching todos:", err)
//     }
//   }

//   useEffect(() => { load() }, [])

//   async function addTodo(e) {
//     e.preventDefault()
//     try {
//       await fetch(`${API_URL}/todos`, {
//         method: 'POST',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({ title })
//       })
//       setTitle('')
//       load()
//     } catch (err) {
//       console.error("Error adding todo:", err)
//     }
//   }

//   async function toggle(id, done) {
//     try {
//       await fetch(`${API_URL}/todos/${id}`, {
//         method: 'PUT',
//         headers: { 'Content-Type': 'application/json' },
//         body: JSON.stringify({ done: !done })
//       })
//       load()
//     } catch (err) {
//       console.error("Error toggling todo:", err)
//     }
//   }

//   async function del(id) {
//     try {
//       await fetch(`${API_URL}/todos/${id}`, { method: 'DELETE' })
//       load()
//     } catch (err) {
//       console.error("Error deleting todo:", err)
//     }
//   }

//   return (
//     <div style={{ padding: '20px', fontFamily: 'Arial' }}>
//       <h1>React TODO App</h1>
//       <form onSubmit={addTodo}>
//         <input
//           value={title}
//           onChange={e => setTitle(e.target.value)}
//           placeholder="New todo"
//         />
//         <button>Add</button>
//       </form>
//       <ul>
//         {todos.map(t => (
//           <li key={t._id}>
//             {t.title} {t.done ? "(done)" : ""}
//             <button onClick={() => toggle(t._id, t.done)}>Toggle</button>
//             <button onClick={() => del(t._id)}>Delete</button>
//           </li>
//         ))}
//       </ul>
//       <p>
//         Backend health:{" "}
//         <a href={`${API_URL.replace('/api','')}/api/health`} target="_blank" rel="noreferrer">
//           /api/health
//         </a>
//       </p>
//       <p>
//         Metrics:{" "}
//         <a href={`${API_URL.replace('/api','')}/metrics`} target="_blank" rel="noreferrer">
//           /metrics
//         </a>
//       </p>
//       <p>Logs (Loki): view in Grafana Explore → Loki</p>
//     </div>
//   )
// }
