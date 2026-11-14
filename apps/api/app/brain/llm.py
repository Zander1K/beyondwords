"""Swappable model interface (Nemotron, Gemini, Muse Spark stub).

Every model call goes through here so providers can be swapped, logged and rate-limited
in one place. TODO(Matthew): define the interface (build order step 3).
"""
