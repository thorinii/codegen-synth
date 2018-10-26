# TODO

* Next aim: build a loop activated by MIDI note
    - MIDI node
    - JS node
    - Noise node
    - JS processing
    - Realtime vars
    - Compiler revamp
    - Runtime revamp

* Convert edge targets into params
* Inlining
* Pipe compiler errors
* Refactor compiler into files (orchestrator, parser, inliner, etc)
* JS node
* MIDI Note node
* Use proper files rather than a workspace file
* Proper DC filter
* Linear timed-ramp envelope node
* Use codemirror editor
* Graph visualisation (live with message flows, energy levels, bulkhead operation, etc)
* Execution graph pass
* Vector edges (use immutable Maps/Lists for data)
* Cheap MIDI note on/off node
* Oversample by graph (then intelligently partition the graph for optimality)
* Generalise to builtin nodes, C Node, and JS Node
* Perf Bulkhead nodes
    - When the input to the node drops below a threshold for a time, it stops
      executing the upstream graph, until woken by a message (or other things?).
* Automatic graph partitioning for multicore
* Compiler graph visualisations
    * Original graph
    * Flattened graph
    * Exec graph
* Cleaner scheduling based on dependencies
    * Keep a node's code in as small an area as possible
    * Each block of code has dependencies and productions