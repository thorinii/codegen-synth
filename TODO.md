# TODO

* Next aim: build a loop activated by MIDI note
    - MIDI node
    - JS node
    - Noise node
    - JS processing
    - Realtime vars
    - Compiler revamp
    - Runtime revamp

* Use a text-based graph editor (EDN/Clojure notation)
    - Parse the text into graphs
* JS node
* MIDI Note node
* DC filter
* Linear timed-ramp envelope node
* Noise node
* Implement a readonly renderer for the graph
* Execution graph pass
* Vector edges (use immutable Maps/Lists for data)
* Default graphs (eg Output node for Instrument)
* Cheap MIDI note on/off node
* Oversample by graph (then intelligently partition the graph for optimality)
* Maths node
* Generalise to builtin nodes, C Node, and JS Node
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