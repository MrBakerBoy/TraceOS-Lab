package kg

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Client is the Knowledge Graph client for Go services.
type Client struct {
	db *pgxpool.Pool
}

// NewClient creates a new KG client with an existing pgxpool connection.
func NewClient(db *pgxpool.Pool) *Client {
	return &Client{db: db}
}

// FindPaths finds all reasoning paths from a start node using recursive CTE.
func (c *Client) FindPaths(ctx context.Context, startName, startLabel string, maxDepth int) ([]Path, error) {
	query := `
		WITH RECURSIVE paths AS (
			SELECT
				e.from_node_id,
				e.to_node_id,
				ARRAY[e.from_node_id, e.to_node_id] as node_ids,
				ARRAY[n1.name, n2.name]::text[] as name_path,
				ARRAY[n1.label, n2.label]::text[] as label_path,
				ARRAY[e.label]::text[] as edge_labels,
				1 as depth
			FROM kg_edges e
			JOIN kg_nodes n1 ON e.from_node_id = n1.id
			JOIN kg_nodes n2 ON e.to_node_id = n2.id
			WHERE n1.name = $1
			  AND ($2::varchar IS NULL OR n1.label = $2)

			UNION ALL

			SELECT
				p.from_node_id,
				e.to_node_id,
				p.node_ids || e.to_node_id,
				p.name_path || n.name,
				p.label_path || n.label,
				p.edge_labels || e.label,
				p.depth + 1
			FROM paths p
			JOIN kg_edges e ON p.to_node_id = e.from_node_id
			JOIN kg_nodes n ON e.to_node_id = n.id
			WHERE p.depth < $3
			  AND NOT (e.to_node_id = ANY(p.node_ids))
		)
		SELECT name_path, label_path, edge_labels, depth
		FROM paths
		ORDER BY depth ASC
	`

	rows, err := c.db.Query(ctx, query, startName, startLabel, maxDepth)
	if err != nil {
		return nil, fmt.Errorf("kg find_paths: %w", err)
	}
	defer rows.Close()

	var paths []Path
	for rows.Next() {
		var p Path
		if err := rows.Scan(&p.NamePath, &p.LabelPath, &p.EdgeLabels, &p.Depth); err != nil {
			return nil, fmt.Errorf("kg scan path: %w", err)
		}
		paths = append(paths, p)
	}
	return paths, nil
}

// Reason performs knowledge graph reasoning based on observed signals.
func (c *Client) Reason(ctx context.Context, syscalls, errorCodes, symptoms []string) (*ReasoningResult, error) {
	var allPaths []Path
	conceptsSeen := make(map[string]bool)
	var traceLines []string

	// Reason from syscalls
	for _, sc := range syscalls {
		paths, err := c.FindPaths(ctx, sc, "Syscall", 5)
		if err != nil {
			continue
		}
		allPaths = append(allPaths, paths...)
		for _, p := range paths {
			for i, label := range p.LabelPath {
				if label == "Concept" {
					conceptsSeen[p.NamePath[i]] = true
				}
			}
			traceLines = append(traceLines, strings.Join(p.NamePath, " -> "))
		}
	}

	// Reason from error codes
	for _, ec := range errorCodes {
		paths, err := c.FindPaths(ctx, ec, "ErrorCode", 5)
		if err != nil {
			continue
		}
		allPaths = append(allPaths, paths...)
		for _, p := range paths {
			for i, label := range p.LabelPath {
				if label == "Concept" {
					conceptsSeen[p.NamePath[i]] = true
				}
			}
			traceLines = append(traceLines, "[Error: "+ec+"] -> "+strings.Join(p.NamePath, " -> "))
		}
	}

	// Reason from symptoms
	for _, sym := range symptoms {
		paths, err := c.FindPaths(ctx, sym, "Symptom", 5)
		if err != nil {
			continue
		}
		allPaths = append(allPaths, paths...)
		for _, p := range paths {
			for i, label := range p.LabelPath {
				if label == "Concept" {
					conceptsSeen[p.NamePath[i]] = true
				}
			}
			traceLines = append(traceLines, "[Symptom: "+sym+"] -> "+strings.Join(p.NamePath, " -> "))
		}
	}

	// Collect concepts
	concepts := make([]string, 0, len(conceptsSeen))
	for c := range conceptsSeen {
		concepts = append(concepts, c)
	}

	return &ReasoningResult{
		Paths:    allPaths,
		Concepts: concepts,
		Trace:    strings.Join(traceLines, "\n"),
		Symptoms: symptoms,
	}, nil
}

// GetRelatedConcepts returns prerequisite and resolution concepts for a given concept.
func (c *Client) GetRelatedConcepts(ctx context.Context, conceptName string) (*ConceptInfo, error) {
	info := &ConceptInfo{Concept: conceptName}

	// Get prerequisites (REQUIRES edges pointing TO other concepts)
	rows, err := c.db.Query(ctx, `
		SELECT n.name
		FROM kg_edges e
		JOIN kg_nodes n ON e.to_node_id = n.id
		WHERE e.label = 'REQUIRES'
		  AND e.from_node_id = (SELECT id FROM kg_nodes WHERE name = $1)
	`, conceptName)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var name string
			rows.Scan(&name)
			info.Prerequisites = append(info.Prerequisites, name)
		}
	}

	// Get resolutions (RESOLVES edges pointing TO other concepts)
	rows2, err := c.db.Query(ctx, `
		SELECT n.name
		FROM kg_edges e
		JOIN kg_nodes n ON e.to_node_id = n.id
		WHERE e.label = 'RESOLVES'
		  AND e.from_node_id = (SELECT id FROM kg_nodes WHERE name = $1)
	`, conceptName)
	if err == nil {
		defer rows2.Close()
		for rows2.Next() {
			var name string
			rows2.Scan(&name)
			info.Resolutions = append(info.Resolutions, name)
		}
	}

	return info, nil
}

// GetExperimentSyscalls returns all syscalls involved in a given experiment.
func (c *Client) GetExperimentSyscalls(ctx context.Context, experimentName string) ([]string, error) {
	paths, err := c.FindPaths(ctx, experimentName, "Experiment", 2)
	if err != nil {
		return nil, err
	}

	seen := make(map[string]bool)
	var syscalls []string
	for _, p := range paths {
		for i, label := range p.LabelPath {
			if label == "Syscall" && !seen[p.NamePath[i]] {
				seen[p.NamePath[i]] = true
				syscalls = append(syscalls, p.NamePath[i])
			}
		}
	}
	return syscalls, nil
}
