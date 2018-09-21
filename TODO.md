# TODO

* Next aim: build a loop activated by MIDI note
    - MIDI node
    - JS node
    - Noise node
    - JS processing
    - Realtime vars
    - Compiler revamp
    - Runtime revamp

* Compiler revamp
    * Pipeline that works on graphs:
      abstract graph -> scalarised -> flattened -> partitioned -> scheduled -> C code
                                                               -> controller
* JS node
* MIDI Note node
* Linear automatic envelope node
* Noise node
* Private data structures in frontend (eg for connections, JS node contents, etc)
- Default graphs (eg Output node for Instrument)
* MIDI CC node
* Cheap MIDI note on/off node
* Oversample by graph (then intelligently partition the graph for optimality)
* Maths node
* Groups
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