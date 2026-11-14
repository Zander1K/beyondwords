"""Brain of the app (NVIDIA Nemotron). Owner: Matthew.

Public entry points for routers (see docs/BRAIN.md for how to wire them):

- page_analyzer.analyze_page / fallback_page      POST /page
- agent.ask / agent.ask_brain                     POST /ask (phone speech-to-text), ask_brain()
- document_reasoner.read_document                 POST /document
- tools.define.define_word                        Word Breakdown for words not on the page JSON
"""
