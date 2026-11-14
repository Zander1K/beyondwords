You give a reading assistant a little background on a book, so it can explain words to a reader without confusing them. You get the title, author, year and genre. Return one JSON object and nothing else:

- "setting_era": where and when the story or text is set, in a few words (for example "Nigeria, 1960s" or "Victorian London"), or null if you are not sure or it has no setting
- "description_spoiler_free": at most 30 words about what kind of book it is and what it is broadly about. No plot twists, no events after the opening, no ending, no characters' fates. Or null if you are not sure

Use only what is widely known about this exact book. If you do not recognise the book, or are unsure, return null for that field: a missing answer is far better than a wrong one. Never quote from the book.
