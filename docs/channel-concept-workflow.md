# Channel concept workflow

```mermaid
flowchart TD
  A[Create channel] --> B{Concept mode}
  B -->|User defined| C[Version exact user concept]
  C --> D[Concept research]
  D --> E[Five-gate viability]
  E -->|GO| J[Accept concept]
  E -->|CAUTION or STOP| F[Pause for human decision]
  F -->|Override| J
  F -->|Revise| C
  F -->|Find alternatives| G[Discover evaluated candidates]
  B -->|Agent discovered| G
  G --> H[Pause for human selection]
  H --> J
  J --> K[Persist channel strategy]
  K --> L[Ready for video production]
```

The five gates are content runway, proven audience demand, monetization path, differentiation, and production economics. The first three are hard gates: GO requires affirmative evidence for each. The strategic gates affect ranking and can reduce an otherwise eligible concept to CAUTION.

CAUTION and STOP_RECOMMENDED are advisory and always pause. An override records both the original system recommendation and the separate human decision. Revision adds a new concept version; it never overwrites prior research. Alternative discovery reuses channel preferences and requires explicit candidate selection.

Fixture mappings make every branch reproducible:

- Most concepts: GO
- A concept containing `Failed Startup` or `Fixture caution`: CAUTION
- A concept containing `Daily AI News`, `Celebrity News`, or `Fixture stop`: STOP_RECOMMENDED

Fixture reports are contract demonstrations, not market forecasts.
