// The stack editor with made-up tickets, for looking at it without a server (dev only: /?gallery=stacks).
import { useState } from 'react'
import { StackEditor } from '../components/ExecList.tsx'
import { shapeOf, type Shape } from '../stackEdit.ts'

const picked = ['AC-17', 'AC-18', 'AC-19', 'AC-20', 'AC-21', 'AC-6']
const planned = shapeOf([['AC-17', 'AC-19', 'AC-20'], ['AC-18'], ['AC-21'], ['AC-6']])
export function StackSheet() {
  const [shape, setShape] = useState<Shape>(planned)
  const [prep, setPrep] = useState(true)
  return (
    <div className="min-h-[100dvh] bg-bg-app p-6 text-fg-1">
      <div className="w-[380px] rounded-2xl bg-surface-1 p-2.5 shadow-e2">
        <StackEditor shape={shape} onShape={setShape} planned={planned} picked={picked} repoOf={(id) => (id === 'AC-6' ? 'acme/desktop' : 'acme/app')} oneRepo={false}
                     why="AC-19 and AC-20 extend the export AC-17 adds; the rest stand alone." prep={{ ids: ['AC-17', 'AC-18', 'AC-19'], task: 'Add the shared ExportState type and its migration.' }} prepOn={prep} onPrep={setPrep} />
      </div>
    </div>
  )
}
