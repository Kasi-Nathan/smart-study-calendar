import os
from dotenv import load_dotenv
from google import genai

load_dotenv()

client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

def generate_study_explanation(
    task,
    course,
    difficulty,
    priority,
    existing_explanation,
    score_breakdown,
):
    prompt = f"""
You are an AI study coach.

Explain this schedule recommendation in simple words.

Task: {task}
Course: {course}
Difficulty: {difficulty}
Priority: {priority}
Reason from scheduler: {existing_explanation}
Scheduler score breakdown: {score_breakdown}

Keep it short, friendly, and useful.
"""

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt
    )

    return response.text
