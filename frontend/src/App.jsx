
import React, { useState, useEffect } from 'react'

export default function App(){
  const [todos,setTodos] = useState([])
  const [title,setTitle] = useState('')

  async function load(){
    const res = await fetch('http://backend:4000/api/todos')
    const data = await res.json()
    setTodos(data)
  }
  useEffect(()=>{load()},[])

  async function addTodo(e){
    e.preventDefault()
    await fetch('http://backend:4000/api/todos',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({title})
    })
    setTitle('')
    load()
  }
  async function toggle(id,done){
    await fetch(`http://backend:4000/api/todos/${id}`,{
      method:'PUT',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({done:!done})
    })
    load()
  }
  async function del(id){
    await fetch(`http://backend:4000/api/todos/${id}`,{method:'DELETE'})
    load()
  }

  return (
    <div style={{padding:'20px',fontFamily:'Arial'}}>
      <h1>React TODO App</h1>
      <form onSubmit={addTodo}>
        <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="New todo"/>
        <button>Add</button>
      </form>
      <ul>
        {todos.map(t=>(
          <li key={t._id}>
            {t.title} {t.done?"(done)":""}
            <button onClick={()=>toggle(t._id,t.done)}>Toggle</button>
            <button onClick={()=>del(t._id)}>Delete</button>
          </li>
        ))}
      </ul>
      <p>Backend health: <a href="http://backend:4000/api/health" target="_blank">/api/health</a></p>
      <p>Metrics: <a href="http://backend:4000/metrics" target="_blank">/metrics</a></p>
      <p>Logs (Loki): view in Grafana Explore -> Loki</p>
    </div>
  )
}
