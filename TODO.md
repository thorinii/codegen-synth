# TODO

* Environment/Serialisation
    - Convert saved graph to (nodes, edges) form
    - Private data structures in frontend (eg for connections, JS node contents, etc)
    - Preserve location info
    - Feed back into GraphUi
    - Add default Output node
* Compiler revamp
    * Pipeline that works on graphs:
      abstract graph -> scalarised -> flattened -> partitioned -> scheduled -> C code
                                                               -> controller
* Noise node
* Linear automatic envelope node
* Low pass node
* MIDI CC node
* JS node
* MIDI Note node
* Cheap MIDI note on/off node
* Maths node
* Groups
* Compiler graph visualisations
    * Original graph
    * Flattened graph
    * Exec graph
* Cleaner scheduling based on dependencies
    * Keep a node's code in as small an area as possible
    * Each block of code has dependencies and productions