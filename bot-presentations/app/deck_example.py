"""Reference deck for the kit: the Taskify product overview. Copy this file to deck.py and replace the content.

Run: .venv/bin/python deck.py   (writes data/seed.json)
"""
from layouts import (title_slide, cards3, steps3, before_after, grid4, pipeline4, statement, roadmap3,
                     closing, build_deck)

slides = [
    title_slide(
        title='Taskify',
        tagline="Say it. We'll sort it.",
        blurb='Talk through your day. Taskify turns the ramble into a checklist you can tick off.',
        tag='LLM-powered to-do lists',
        footer='Product overview  ·  October 2026',
        card_title='Saturday',
        card_sub='4 items from one voice note',
        items=[('Milk, 2 litres', True), ('Call Mom about Sunday', False), ('Metformin at 8 pm', False),
               ('Book the car service', False)],
        button='Hold to talk',
        notes='Taskify in one line: you talk, it makes the list. The card on the right is the whole product.'),

    cards3('THE PROBLEM', 'To-dos start as thoughts,\nnot forms.', [
        ('Typing is friction', 'Open an app, find the list, type each item. Most thoughts die before step two.'),
        ('Lists are scattered', 'Groceries in notes, meds in reminders, chores in a chat with yourself.'),
        ('Context gets lost', '“Call Mom about Sunday lunch” shrinks to “Mom” once it has to be typed.')],
        notes='Three reasons lists fail today: effort, fragmentation and lost context.'),

    steps3('HOW IT WORKS', 'Talk. Taskify listens.\nYou tick.', [
        ('Speak freely', 'Hold the mic and ramble. No format, no wake words, no menus.'),
        ('AI extracts actions', 'An LLM picks out each actionable item, with quantity, time and category.'),
        ('Get a checklist', 'Items land in the right list, ready to tick off or share.')],
        notes='The whole interaction is three steps. Only step two needs the model.'),

    before_after('IN ACTION', 'One ramble. One clean list.',
        'YOU SAID',
        "“Okay so… we're out of milk, get two litres. Oh, and I need to call Mom about Sunday lunch. Don't let me forget my metformin at eight tonight. And the car is due for a service sometime this week.”",
        'TASKIFY MADE',
        [('Milk, 2 litres', 'Shopping'), ('Call Mom: Sunday lunch', 'Calls'), ('Metformin, 8:00 pm', 'Medicine'),
         ('Book the car service', 'This week')],
        notes='Read the transcript aloud, then point at the list. Four items, each filed and timed.'),

    grid4('ONE APP, MANY LISTS', 'Whatever you say,\nit fits somewhere.', [
        ('S', 'Shopping lists', '“Eggs, bread and the cheese Sam likes” becomes three items, grouped by aisle.'),
        ('T', 'To-do lists', 'People and deadlines are pulled out, so “finish the deck by Friday” gets a due date.'),
        ('M', 'Medicine lists', 'Doses and times turn into reminders: “one tablet after dinner, every day.”'),
        ('P', 'Packing & errands', 'Trips and chores split into checklists you can share with the family.')],
        notes='Same capture flow, different lists. Medicine is the one people care about most.'),

    pipeline4('UNDER THE HOOD', 'A simple pipeline with\none smart step.', [
        ('Voice capture', 'Records on the phone and trims silence.'),
        ('Speech to text', 'Streams a punctuated transcript.'),
        ('LLM extraction', 'Finds actions, amounts, times and lists. Returns JSON.'),
        ('Lists & reminders', 'Dedupes, files and syncs across devices.')],
        code_caption='Extracted from “my metformin at eight tonight”',
        code='{ "item": "Metformin", "time": "20:00", "repeat": "daily", "list": "Medicine" }',
        notes='Only the extraction step is AI. Everything else is plain, reliable plumbing.'),

    statement('WHY TASKIFY', 'No forms.\nNo fields.\nJust talk.',
        'The app adapts to how people already think out loud.', [
        ('Understands context', '“After the gym” and “before Mom\'s call” become real times.'),
        ('Cleans up the ramble', 'Ums, repeats and corrections are dropped; duplicates merge.'),
        ('Sorts on its own', 'Each item lands in the list where it belongs.'),
        ('Shares in one tap', 'Send the shopping list to whoever is at the store.')],
        notes='The difference is the input model: speech first, structure second.'),

    roadmap3("WHAT'S NEXT", 'Roadmap', [
        ('NOW', 'Core capture', ['Voice to checklist', 'Shopping, to-do and medicine lists', 'Share any list']),
        ('NEXT QUARTER', 'Smarter lists', ['Recurring reminders', 'Group items by store aisle', 'Home-screen widgets']),
        ('LATER', 'Shared homes', ['Household spaces', 'Calendar sync', 'Offline transcription'])],
        notes='Ship the core loop first; reminders and sharing make it a daily habit.'),

    closing('Taskify', 'Stop typing lists.\nStart talking.', "Questions, demos and beta invites: let's talk.",
            'Product overview  ·  October 2026', notes='End on the call to action. Offer a live demo.'),
]

build_deck('Taskify — Product Overview', slides, theme='sand')
