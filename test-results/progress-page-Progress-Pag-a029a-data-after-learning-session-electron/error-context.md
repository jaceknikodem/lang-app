# Page snapshot

```yaml
- generic [ref=e2]:
  - heading "Local Language Learning" [level=1] [ref=e3]
  - generic [ref=e4]: Loading application...
  - generic [ref=e6]:
    - banner [ref=e7]:
      - heading "Local Language Learning" [level=1] [ref=e8]
      - navigation [ref=e9]:
        - button "Start Learning" [ref=e10] [cursor=pointer]
        - button "Review" [disabled] [ref=e11]
        - button "Quiz" [disabled] [ref=e12]
        - button "Progress" [ref=e13] [cursor=pointer]
    - main [ref=e14]:
      - generic [ref=e17]:
        - generic [ref=e18]:
          - heading "Choose Your Learning Focus" [level=2] [ref=e19]
          - paragraph [ref=e20]: Enter a topic to generate relevant vocabulary, or skip to practice with general high-frequency words.
        - generic [ref=e22]:
          - generic [ref=e23]: Topic (Optional)
          - textbox "Topic (Optional)" [ref=e24]:
            - /placeholder: e.g., travel, food, business, family...
            - text: test-progress
          - paragraph [ref=e25]: Leave blank for general vocabulary, or enter a specific topic like "cooking", "travel", or "business".
        - generic [ref=e27]:
          - button "Generate Topic Words" [ref=e28] [cursor=pointer]
          - button "Skip Topic" [ref=e29] [cursor=pointer]
```