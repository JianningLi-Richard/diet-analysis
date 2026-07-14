import pandas as pd
import seaborn as sns
import matplotlib.pyplot as plt
import os

# 1. Load the dataset
df = pd.read_csv('All_Diets.csv')
print("Columns:", df.columns.tolist())
print(df.head())

# 2. Clean data: fill numeric NaN with column mean
numeric_cols = ['Protein(g)', 'Carbs(g)', 'Fat(g)']
df[numeric_cols] = df[numeric_cols].fillna(df[numeric_cols].mean())

# Normalize Diet_type casing (e.g., 'paleo' → 'Paleo')
df['Diet_type'] = df['Diet_type'].str.strip().str.title()

# 3. Average macronutrients per diet type
avg_macros = df.groupby('Diet_type')[numeric_cols].mean()
print("\nAverage Macros per Diet Type:")
print(avg_macros)

# 4. Top 5 protein-rich recipes per diet type
top_protein = (df.sort_values('Protein(g)', ascending=False)
                 .groupby('Diet_type')
                 .head(5))
print("\nTop 5 Protein-Rich Recipes per Diet Type:")
print(top_protein[['Diet_type', 'Recipe_name', 'Protein(g)']])

# 5. Diet type with the highest overall protein
highest_protein_diet = avg_macros['Protein(g)'].idxmax()
print(f"\nDiet with highest avg protein: {highest_protein_diet}")

# 6. Most common cuisine per diet type
most_common_cuisine = (df.groupby('Diet_type')['Cuisine_type']
                         .agg(lambda x: x.value_counts().idxmax()))
print("\nMost Common Cuisine per Diet Type:")
print(most_common_cuisine)

# 7. New metrics: ratios
df['Protein_to_Carbs_ratio'] = df['Protein(g)'] / df['Carbs(g)'].replace(0, float('nan'))
df['Carbs_to_Fat_ratio']     = df['Carbs(g)']   / df['Fat(g)'].replace(0, float('nan'))
print("\nSample ratios:")
print(df[['Recipe_name', 'Protein_to_Carbs_ratio', 'Carbs_to_Fat_ratio']].head())

os.makedirs('output', exist_ok=True)

# 8. Bar chart: average macronutrients per diet type
avg_macros.plot(kind='bar', figsize=(12, 6))
plt.title('Average Macronutrient Content by Diet Type')
plt.ylabel('Grams (g)')
plt.xticks(rotation=45, ha='right')
plt.tight_layout()
plt.savefig('output/bar_avg_macros.png')
plt.show()

# 9. Heatmap: macronutrients vs diet type
plt.figure(figsize=(10, 6))
sns.heatmap(avg_macros, annot=True, fmt='.1f', cmap='YlOrRd')
plt.title('Heatmap: Macronutrient Content by Diet Type')
plt.tight_layout()
plt.savefig('output/heatmap_macros.png')
plt.show()

# 10. Scatter plot: top-5 protein recipes across cuisines
plt.figure(figsize=(12, 6))
sns.scatterplot(data=top_protein, x='Cuisine_type', y='Protein(g)',
                hue='Diet_type', s=100)
plt.title('Top 5 Protein-Rich Recipes by Cuisine')
plt.xticks(rotation=45, ha='right')
plt.tight_layout()
plt.savefig('output/scatter_top_protein.png')
plt.show()

print("\nAll charts saved to output/")
